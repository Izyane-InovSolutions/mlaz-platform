import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { lusakaHour, todayIso } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { withLease } from '../lib/leases.js';
import { expireMofAuthorizations, lapseEndedPeriods, sendReminders } from '../services/membership.js';
import { processOutbox } from '../services/notifications.js';
import { expireStale, reconcilePending } from '../services/payments.js';

// In-process scheduler. Every step is safe to run on several API instances at once: the outbox uses SKIP LOCKED,
// payment settlement locks the payment row, reconciliation runs under a cluster-wide lease (one instance per
// interval), and the nightly job is claimed once per day with an atomic update.

const TICK_MS = 10_000;
const RECONCILE_EVERY_MS = 5 * 60_000;
// Longer than one gateway status query can take (PAYMENT_INITIATE_TIMEOUT_SECONDS, at most 120 s). The holder renews
// it before each payment, so a long run keeps it, and a crashed holder's lease frees itself within this time.
const RECONCILE_LEASE_MS = 3 * 60_000;
const NIGHTLY_HOUR = 1; // 01:00 Lusaka time

/**
 * Runs the nightly membership rules. Each rule runs even if an earlier one failed; the failures are reported. Every
 * rule catches up on a missed night: lapsing and MoF expiry act on anything already past its date, and reminders on
 * anything inside its reminder window that has not had that reminder yet. Exported for tests and for running by hand.
 */
export async function runNightly() {
  const failed: string[] = [];
  const run = async <T>(name: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      failed.push(name);
      console.error(`Nightly job: ${name} failed (${(err as Error).message})`);
      return null;
    }
  };
  const lapsed = await run('lapse', lapseEndedPeriods);
  const mofExpired = await run('mofExpiry', expireMofAuthorizations);
  const reminders = await run('reminders', sendReminders);
  if (reminders?.failed) failed.push('reminders'); // the rest went out; the failed ones are retried tomorrow
  const pruned = await run('prune', pruneAuthRecords);
  return { lapsed, mofExpired, reminders, pruned, failed };
}

/**
 * Reconciles pending payments on one instance in the cluster at a time. With a real gateway, the lease is then held
 * until RECONCILE_EVERY_MS after the run started, so N instances query the gateway once per interval, not N times.
 * Returns null when another instance holds the lease. Exported for tests.
 */
export async function runReconcile(everyMs = config.PAYMENT_PROVIDER === 'sandbox' ? 0 : RECONCILE_EVERY_MS) {
  const ran = await withLease('payments.reconcile', RECONCILE_LEASE_MS, lease => reconcilePending(undefined, lease.renew), elapsed => everyMs - elapsed);
  return ran && ran.result;
}

/**
 * Deletes sign-in records nobody can use any more: sessions past their deadline (with their refresh tokens) after a
 * 30-day grace kept for investigating, emailed codes, and throttle counters idle for a day with no block in force.
 */
export async function pruneAuthRecords() {
  const day = 864e5, now = Date.now();
  const sessions = await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date(now - 30 * day) } } });
  const legacy = await prisma.refreshToken.deleteMany({ where: { sessionId: null, expiresAt: { lt: new Date(now - 30 * day) } } });
  const codes = await prisma.userToken.deleteMany({ where: { purpose: 'LOGIN_CHALLENGE', expiresAt: { lt: new Date(now - day) } } });
  const throttles = await prisma.loginThrottle.deleteMany({
    where: { windowStart: { lt: new Date(now - day) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now - day) } }] },
  });
  return { sessions: sessions.count, refreshTokens: legacy.count, codes: codes.count, throttles: throttles.count };
}

/** Claims today's nightly run. Returns true for exactly one caller per day. */
async function claimNightly() {
  const day = todayIso();
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ('jobs.nightly.lastRun', to_jsonb(${day}::text), now())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE "Setting"."value" IS DISTINCT FROM EXCLUDED."value"
    RETURNING "key"`;
  return rows.length > 0;
}

/**
 * Starts the scheduler. Each job runs on its own, so one that fails (say, the mail server is down) does not hold up
 * the others. Returns a stop function that resolves once the job in progress, if any, has finished, so shutdown never
 * closes the database under it.
 */
export function startJobs(log: FastifyBaseLogger) {
  let running: Promise<void> | null = null;
  let stopped = false;

  const step = async (job: string, fn: () => Promise<unknown>) => {
    if (stopped) return;
    try {
      await fn();
    } catch (err) {
      log.error({ err, job }, 'background job failed');
    }
  };

  const tick = async () => {
    await step('outbox', processOutbox);
    // The sandbox settles by being asked; real gateways send webhooks, with reconciliation as a safety net. Every
    // instance asks each tick; the lease decides which one (if any) runs.
    await step('reconcile', runReconcile);
    await step('expire', expireStale);
    // Claimed before it runs, so two instances never both run it. A rule that fails is logged and retried the next
    // night, and each rule catches up on what a missed or failed night left undone (see runNightly).
    await step('nightly', async () => {
      if (lusakaHour() < NIGHTLY_HOUR || !(await claimNightly())) return;
      const result = await runNightly();
      if (result.failed.length) log.error({ job: 'nightly', ...result }, 'nightly membership job finished with failures');
      else log.info({ job: 'nightly', ...result }, 'nightly membership job finished');
    });
  };

  const run = () => {
    if (running || stopped) return; // never overlaps itself
    running = tick().finally(() => { running = null; });
  };

  const timer = setInterval(run, TICK_MS);
  run();
  log.info('background jobs started');
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

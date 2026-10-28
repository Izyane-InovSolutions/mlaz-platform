import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { lusakaHour, todayIso } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { expireMofAuthorizations, lapseEndedPeriods, sendReminders } from '../services/membership.js';
import { processOutbox } from '../services/notifications.js';
import { expireStale, reconcilePending } from '../services/payments.js';

// In-process scheduler. Every step is safe to run on several API instances at once: the outbox uses SKIP LOCKED,
// payment settlement locks the payment row, and the nightly job is claimed once per day with an atomic update.

const TICK_MS = 10_000;
const RECONCILE_EVERY_MS = 5 * 60_000;
const NIGHTLY_HOUR = 1; // 01:00 Lusaka time

/** Runs the nightly membership rules. Exported for tests and for running by hand. */
export async function runNightly() {
  const lapsed = await lapseEndedPeriods();
  const mofExpired = await expireMofAuthorizations();
  const reminders = await sendReminders();
  return { lapsed, mofExpired, reminders, pruned: await pruneAuthRecords() };
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
  let lastReconcile = 0;

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
    // The sandbox settles by being asked; real gateways send webhooks, with reconciliation as a safety net.
    if (config.PAYMENT_PROVIDER === 'sandbox' || Date.now() - lastReconcile > RECONCILE_EVERY_MS) {
      await step('reconcile', async () => { await reconcilePending(); lastReconcile = Date.now(); });
    }
    await step('expire', expireStale);
    // Claimed before it runs, so two instances never both run it; if it fails part-way it waits for tomorrow (the
    // error is logged). Lapsing and MoF expiry catch up on a missed night; reminders are for exact dates and do not.
    await step('nightly', async () => {
      if (lusakaHour() >= NIGHTLY_HOUR && (await claimNightly())) log.info({ job: 'nightly', ...(await runNightly()) }, 'nightly membership job finished');
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

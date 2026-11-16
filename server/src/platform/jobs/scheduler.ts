import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../config.js';
import { lusakaHour, todayIso } from '../../shared/dates.js';
import { prisma } from '../../shared/db.js';
import { log } from '../../shared/log.js';
import { processOutbox } from '../../modules/communications/index.js';
import { sweepStorage } from '../../modules/documents/index.js';
import { pruneAuthRecords } from '../../modules/identity/index.js';
import { expireMofAuthorizations, lapseEndedPeriods, sendReminders } from '../../modules/membership/index.js';
import { expireStale, reconcilePending } from '../../modules/payments/index.js';
import { wireModules } from '../modules.js';
import { withLease } from './leases.js';

// In-process scheduler. Jobs only decide when work runs; the work itself is each module's own use case. Every step is
// safe to run on several API instances at once: the outbox uses SKIP LOCKED, payment settlement locks the payment row,
// reconciliation runs under a cluster-wide lease (one instance per interval), and the nightly job is claimed once per
// day with an atomic update.

const TICK_MS = 10_000;
const RECONCILE_EVERY_MS = 5 * 60_000;
// Longer than one gateway status query can take (PAYMENT_INITIATE_TIMEOUT_SECONDS, at most 120 s). The holder renews
// it before each payment, so a long run keeps it, and a crashed holder's lease frees itself within this time.
const RECONCILE_LEASE_MS = 3 * 60_000;
const NIGHTLY_HOUR = 1; // 01:00 Lusaka time
const STORAGE_SWEEP_HOUR = 2;

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
      log().error({ event: 'job.failed', job: `nightly.${name}`, err }, `Nightly job: ${name} failed`);
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

/** Claims today's run of a daily job. Returns true for exactly one caller per day across the cluster. */
async function claimDaily(key: string) {
  const day = todayIso();
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES (${key}, to_jsonb(${day}::text), now())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE "Setting"."value" IS DISTINCT FROM EXCLUDED."value"
    RETURNING "key"`;
  return rows.length > 0;
}

/** How each job has fared on this instance since it started. Read by the monitoring endpoint (/health/status). */
export interface JobHealth { lastSuccessAt: Date | null; lastFailureAt: Date | null; consecutiveFailures: number }
const health = new Map<string, JobHealth>();
export const jobHealth = () => Object.fromEntries(health);
let started: Date | null = null;
/** When this instance's scheduler started, or null when jobs are off here (JOBS_ENABLED=false). */
export const jobsStartedAt = () => started;

/**
 * Starts the scheduler. Each job runs on its own, so one that fails (say, the mail server is down) does not hold up
 * the others. Returns a stop function that resolves once the job in progress, if any, has finished, so shutdown never
 * closes the database under it. Stopping also cuts a long outbox batch short between two messages (the rest go back
 * to the queue), so a deploy's grace period is enough.
 */
export function startJobs(logger: FastifyBaseLogger) {
  wireModules();
  let running: Promise<void> | null = null;
  let stopped = false;
  const stopping = new AbortController();
  started = new Date();

  const step = async (job: string, fn: () => Promise<unknown>) => {
    if (stopped) return;
    const h = health.get(job) ?? { lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0 };
    health.set(job, h);
    try {
      await fn();
      h.lastSuccessAt = new Date();
      h.consecutiveFailures = 0;
    } catch (err) {
      h.lastFailureAt = new Date();
      h.consecutiveFailures++;
      logger.error({ event: 'job.failed', err, job, consecutiveFailures: h.consecutiveFailures }, 'background job failed');
    }
  };

  const tick = async () => {
    await step('outbox', () => processOutbox(undefined, undefined, stopping.signal));
    // The sandbox settles by being asked; real gateways send webhooks, with reconciliation as a safety net. Every
    // instance asks each tick; the lease decides which one (if any) runs.
    await step('reconcile', runReconcile);
    await step('expire', expireStale);
    // Claimed before it runs, so two instances never both run it. A rule that fails is logged and retried the next
    // night, and each rule catches up on what a missed or failed night left undone (see runNightly).
    await step('nightly', async () => {
      if (lusakaHour() < NIGHTLY_HOUR || !(await claimDaily('jobs.nightly.lastRun'))) return;
      const result = await runNightly();
      if (result.failed.length) logger.error({ event: 'job.nightly_failures', job: 'nightly', ...result }, 'nightly membership job finished with failures');
      else logger.info({ event: 'job.nightly_finished', job: 'nightly', ...result }, 'nightly membership job finished');
    });
    // Once a day, compare stored files with document records (see docs/OPERATIONS.md, "Document storage integrity").
    await step('storage-sweep', async () => {
      if (config.STORAGE_SWEEP === 'off' || lusakaHour() < STORAGE_SWEEP_HOUR || !(await claimDaily('jobs.storageSweep.lastRun'))) return;
      await sweepStorage({ remove: config.STORAGE_SWEEP === 'delete', graceMs: config.STORAGE_ORPHAN_GRACE_HOURS * 3600e3 });
    });
  };

  const run = () => {
    if (running || stopped) return; // never overlaps itself
    running = tick().finally(() => { running = null; });
  };

  const timer = setInterval(run, TICK_MS);
  run();
  logger.info('background jobs started');
  return async () => {
    stopped = true;
    stopping.abort();
    clearInterval(timer);
    await running;
  };
}

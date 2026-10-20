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
  return { lapsed, mofExpired, reminders };
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

export function startJobs(log: FastifyBaseLogger) {
  let busy = false;
  let lastReconcile = 0;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await processOutbox();
      // The sandbox settles by being asked; real gateways send webhooks, with reconciliation as a safety net.
      if (config.PAYMENT_PROVIDER === 'sandbox' || Date.now() - lastReconcile > RECONCILE_EVERY_MS) {
        await reconcilePending();
        lastReconcile = Date.now();
      }
      await expireStale();
      if (lusakaHour() >= NIGHTLY_HOUR && (await claimNightly())) {
        log.info({ job: 'nightly', ...(await runNightly()) }, 'nightly membership job finished');
      }
    } catch (err) {
      log.error({ err }, 'background job failed');
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(tick, TICK_MS);
  void tick();
  log.info('background jobs started');
  return () => clearInterval(timer);
}

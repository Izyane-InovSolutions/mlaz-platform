import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { config, isProd } from '../../config.js';
import { isoDate, lusakaHour, todayIso } from '../../shared/dates.js';
import { prisma } from '../../shared/db.js';
import { integrations } from '../../shared/integrations.js';
import { safeEqual } from '../../shared/tokens.js';
import { jobHealth, jobsStartedAt } from '../jobs/scheduler.js';

const HEALTH_DB_TIMEOUT_MS = 2000;

/**
 * Probes: /health/live says the process is serving (restart it if not); /health says it can do real work, because the
 * database answers within HEALTH_DB_TIMEOUT_MS (take it out of the load balancer if not). Fastify answers 503 to both
 * while shutting down. Never rate limited, so a busy instance is not reported dead by its own probe.
 */
export function registerHealthProbes(app: FastifyInstance) {
  const probe = { config: { rateLimit: false } };
  app.get('/health/live', probe, async () => ({ ok: true }));
  app.get('/health', probe, async (req, reply) => {
    if (!(await databaseAnswers(req.log))) return reply.status(503).send({ error: { code: 'NOT_READY', message: 'The database is not answering.' } });
    return { ok: true, time: new Date().toISOString() };
  });
}

async function databaseAnswers(logger: FastifyBaseLogger) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    prisma.$queryRaw`SELECT 1`.then(() => true),
    new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), HEALTH_DB_TIMEOUT_MS); }),
  ]).catch(err => {
    logger.warn({ event: 'health.database_unavailable', err }, 'health check: database unavailable');
    return false;
  }).finally(() => clearTimeout(timer));
}

type Level = 'ok' | 'warn' | 'fail';
interface Check { status: Level; [detail: string]: unknown }
const worst = (checks: Check[]): Level => checks.some(c => c.status === 'fail') ? 'fail' : checks.some(c => c.status === 'warn') ? 'warn' : 'ok';

// Thresholds; docs/OPERATIONS.md ("Monitoring and alerting") explains each one.
const OUTBOX_STALL_MS = 15 * 60e3; // a due message not sent within this long means delivery has stopped
const PAYMENT_STUCK_MS = 30 * 60e3; // gateway payments are expired after 30 minutes (payments' expireStale)
const JOB_FAILURES_FAIL = 3; // consecutive failures of one job on this instance
const OUTBOX_IDLE_MS = 5 * 60e3; // the outbox step runs every 10 s; no success for this long means the scheduler is stuck

/**
 * Operational checks for a monitoring service: GET /health/status with `Authorization: Bearer <MONITORING_TOKEN>`.
 * Counts and states only, never personal data. 200 when nothing has failed (status "ok" or "degraded"), 503 when a
 * check has failed, so a plain HTTP monitor can alert on the status code. 404 when MONITORING_TOKEN is not set.
 */
export function registerStatusEndpoint(app: FastifyInstance) {
  app.get('/health/status', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!config.MONITORING_TOKEN) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
    const auth = req.headers.authorization ?? '';
    if (!safeEqual(auth, `Bearer ${config.MONITORING_TOKEN}`)) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Monitoring token required.' } });

    const now = Date.now();
    const database: Check = { status: (await databaseAnswers(req.log)) ? 'ok' : 'fail' };
    const checks: Record<string, Check> = { database };
    if (database.status === 'ok') {
      const [failed24h, overdue, stuckPayments, nightly] = await Promise.all([
        prisma.notification.count({ where: { status: 'FAILED', createdAt: { gte: new Date(now - 24 * 3600e3) } } }),
        prisma.notification.count({ where: { status: 'PENDING', sendAfter: { lt: new Date(now - OUTBOX_STALL_MS) } } }),
        prisma.payment.count({ where: { status: 'PENDING', method: { notIn: ['BANK_TRANSFER', 'CASH'] }, createdAt: { lt: new Date(now - PAYMENT_STUCK_MS) } } }),
        prisma.setting.findUnique({ where: { key: 'jobs.nightly.lastRun' } }),
      ]);
      checks.outbox = { status: overdue ? 'fail' : failed24h ? 'warn' : 'ok', overdue, failedLast24h: failed24h };
      checks.payments = { status: stuckPayments ? 'warn' : 'ok', pendingOver30Minutes: stuckPayments };
      // The nightly run starts at 01:00 Lusaka time on whichever instance claims it; by 02:00 it must have today's date.
      const lastRun = typeof nightly?.value === 'string' ? nightly.value : null;
      const expected = lusakaHour() >= 2 ? [todayIso()] : [todayIso(), isoDate(new Date(now - 864e5))];
      checks.nightly = { status: lastRun && expected.includes(lastRun) ? 'ok' : 'fail', lastRun };
    }
    // This instance's scheduler. With several instances, monitor each one, or the one that runs jobs.
    const started = jobsStartedAt();
    if (!started) checks.jobs = { status: 'ok', enabled: false };
    else {
      const jobs = jobHealth();
      const failing = Object.entries(jobs).filter(([, h]) => h.consecutiveFailures >= JOB_FAILURES_FAIL).map(([name]) => name);
      const outboxAt = jobs.outbox?.lastSuccessAt?.getTime() ?? started.getTime();
      const stuck = now - outboxAt > OUTBOX_IDLE_MS;
      checks.jobs = { status: failing.length || stuck ? 'fail' : 'ok', enabled: true, failing, stuck, jobs };
    }
    // A simulated integration on a production server means a staging site (ALLOW_SANDBOX_IN_PRODUCTION), or a mistake.
    const integ = integrations();
    checks.integrations = { status: isProd && Object.values(integ).some(i => i.state === 'simulated') ? 'warn' : 'ok', ...integ };

    const level = worst(Object.values(checks));
    if (level === 'fail') req.log.error({ event: 'health.status_failing', failing: Object.entries(checks).filter(([, c]) => c.status === 'fail').map(([k]) => k) }, 'status check failing');
    return reply.status(level === 'fail' ? 503 : 200).send({ status: level === 'ok' ? 'ok' : level === 'warn' ? 'degraded' : 'failing', time: new Date(now).toISOString(), checks });
  });
}

/**
 * Content-Security-Policy violation reports from the UI (report-uri / report-to). Only the directive and the origins
 * and paths involved are logged: never query strings, fragments, page content or cookies.
 */
export function registerCspReports(app: FastifyInstance) {
  const cspTypes = ['application/csp-report', 'application/reports+json'];
  app.addContentTypeParser(cspTypes, { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    try { done(null, JSON.parse(body as string)); } catch { done(null, null); }
  });
  const originOf = (u: unknown) => {
    if (typeof u !== 'string') return undefined;
    try { const x = new URL(u); return `${x.origin}${x.pathname}`.slice(0, 200); } catch { return u.slice(0, 40); } // 'inline', 'eval'…
  };
  app.post('/api/csp-report', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = req.body as Record<string, unknown> | Record<string, unknown>[] | null;
    const reports = (Array.isArray(raw) ? raw.map(r => r.body) : [raw?.['csp-report']]).filter(Boolean).slice(0, 20) as Record<string, unknown>[];
    for (const r of reports) {
      req.log.warn({ csp: {
        directive: String(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? '').slice(0, 60),
        blocked: originOf(r['blocked-uri'] ?? r.blockedURL), page: originOf(r['document-uri'] ?? r.documentURL),
        disposition: String(r.disposition ?? '').slice(0, 12),
      } }, 'CSP violation');
    }
    return reply.status(204).send();
  });
}

// Production-readiness behaviour (November 2026): structured logging, the monitoring endpoint, production refusals for
// simulated integrations, the storage integrity sweep, the outbox's stop signal and the credit bureau's deadline.
import { Writable } from 'node:stream';
import { utimes } from 'node:fs/promises';
import path from 'node:path';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config, productionProblems } from '../src/config.js';
import { MAX_REMOVALS_PER_RUN, sweepStorage } from '../src/modules/documents/application/integrity.js';
import { storage } from '../src/modules/documents/infrastructure/storage.js';
import { mailer } from '../src/modules/communications/infrastructure/messaging.js';
import { processOutbox } from '../src/modules/communications/index.js';
import { bureau } from '../src/modules/lending/infrastructure/bureau.js';
import { buildApp } from '../src/platform/http/app.js';
import { todayIso } from '../src/shared/dates.js';
import { prisma } from '../src/shared/db.js';
import { LOG_OPTIONS, log } from '../src/shared/log.js';
import { PDF, as, getApp, makeMember, resetDb } from './helpers.js';

afterEach(() => { vi.restoreAllMocks(); });

// Both are read when used, so a test can set them (and must put them back).
const TOKEN = 'monitoring-token-for-tests-0123456789abcdef';
const saved = { MONITORING_TOKEN: config.MONITORING_TOKEN, BUREAU_TIMEOUT_SECONDS: config.BUREAU_TIMEOUT_SECONDS };
beforeAll(() => { Object.assign(config, { MONITORING_TOKEN: TOKEN, BUREAU_TIMEOUT_SECONDS: 1 }); });
afterAll(() => { Object.assign(config, saved); });

describe('structured logging', () => {
  it('inside a request, module code logs through that request’s logger (so every line carries its id)', async () => {
    const app = await buildApp();
    app.get('/__current-logger', async req => ({ same: log() === req.log }));
    await app.ready();
    const r = await app.inject({ method: 'GET', url: '/__current-logger' });
    expect(r.json()).toEqual({ same: true });
    expect(r.headers['x-request-id']).toBeTruthy();
    await app.close();
  });

  it('redacts credentials, personal identifiers and URL tokens, but keeps error codes', () => {
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } });
    const logger = pino({ ...LOG_OPTIONS, level: 'info' }, sink);
    logger.info({ password: 'hunter2-secret', body: { token: 'tok-123', mfaCode: '123456', nrc: '284512/11/1' }, err: { code: 'ECONNRESET' } }, 'x');
    logger.info({ req: { method: 'GET', url: '/api/public/track?t=abc123&x=1' } }, 'y');
    const out = lines.join('');
    for (const secret of ['hunter2-secret', 'tok-123', '123456', '284512/11/1', 'abc123']) expect(out).not.toContain(secret);
    expect(out).toContain('ECONNRESET');
    expect(out).toContain('"service":"mlaz-api"');
  });
});

describe('production refuses simulated integrations', () => {
  const env = { TRUST_PROXY_HOPS: '1' };
  const base = { ...config, COOKIE_SECURE: true, CORS_ORIGINS: ['https://mlaz.example'], PUBLIC_APP_URL: 'https://mlaz.example', SMTP_URL: 'smtp://mail.example', REQUIRE_STAFF_2FA: true };

  it('refuses the simulated credit bureau and the SMS log driver', () => {
    const problems = productionProblems({ ...base, BUREAU_DRIVER: 'simulated', SMS_DRIVER: 'log', ALLOW_SANDBOX_IN_PRODUCTION: false }, env).join('\n');
    expect(problems).toMatch(/BUREAU_DRIVER=simulated/);
    expect(problems).toMatch(/SMS_DRIVER=log/);
  });

  it('accepts them turned off; a staging site may keep the simulated bureau, never the SMS log driver', () => {
    const off = productionProblems({ ...base, BUREAU_DRIVER: 'none', SMS_DRIVER: 'none', ALLOW_SANDBOX_IN_PRODUCTION: false }, env).join('\n');
    expect(off).not.toMatch(/BUREAU_DRIVER|SMS_DRIVER/);
    const staging = productionProblems({ ...base, BUREAU_DRIVER: 'simulated', SMS_DRIVER: 'log', ALLOW_SANDBOX_IN_PRODUCTION: true }, env).join('\n');
    expect(staging).not.toMatch(/BUREAU_DRIVER/);
    expect(staging).toMatch(/SMS_DRIVER=log/);
  });
});

describe('GET /health/status', () => {
  beforeAll(resetDb);
  const status = async (authorization?: string) => (await getApp()).inject({ method: 'GET', url: '/health/status', headers: authorization ? { authorization } : {} });

  it('needs the monitoring token', async () => {
    expect((await status()).statusCode).toBe(401);
    expect((await status('Bearer wrong-token')).statusCode).toBe(401);
  });

  it('fails when the nightly run is overdue or delivery has stalled, without revealing any recipient', async () => {
    await prisma.setting.deleteMany({ where: { key: 'jobs.nightly.lastRun' } });
    await prisma.notification.create({ data: { channel: 'EMAIL', to: 'stalled.person@example.zm', subject: 's', body: 'b', sendAfter: new Date(Date.now() - 3600e3) } });
    const r = await status(`Bearer ${TOKEN}`);
    expect(r.statusCode).toBe(503);
    const body = r.json();
    expect(body.status).toBe('failing');
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.outbox).toMatchObject({ status: 'fail', overdue: 1 });
    expect(body.checks.jobs).toMatchObject({ status: 'ok', enabled: false }); // JOBS_ENABLED=false in tests
    expect(body.checks.integrations.sms).toEqual({ driver: 'log', state: 'simulated' });
    expect(r.body).not.toContain('stalled.person');
  });

  it('is ok once those are resolved', async () => {
    await prisma.notification.deleteMany();
    await prisma.setting.upsert({ where: { key: 'jobs.nightly.lastRun' }, create: { key: 'jobs.nightly.lastRun', value: todayIso() }, update: { value: todayIso() } });
    const r = await status(`Bearer ${TOKEN}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('ok');
  });
});

describe('storage integrity sweep', () => {
  const DAY = 24 * 3600e3;
  const key = (kind = 'resource') => `${kind}/2026/${crypto.randomUUID()}.pdf`;
  const age = async (k: string, ms: number) => {
    const t = new Date(Date.now() - ms);
    await utimes(path.resolve(config.STORAGE_DIR, k), t, t);
  };
  // The stream is discarded at once; its file may be removed before its open completes, so its errors are ignored.
  const exists = async (k: string) => storage.stream(k).then(s => { s.on('error', () => {}); s.destroy(); return true; }, () => false);
  const record = (storageKey: string) => prisma.document.create({ data: { kind: 'RESOURCE', storageKey, filename: 'a.pdf', mimeType: 'application/pdf', size: PDF.length, sha256: 'x', uploadedBy: 'test' } });

  const emptyStorage = async () => { for await (const o of storage.list()) await storage.remove(o.key); };
  beforeAll(async () => { await resetDb(); await emptyStorage(); });
  afterAll(emptyStorage);

  it('reports files without a record and records without a file, removing nothing in report mode', async () => {
    const recorded = key(), orphan = key(), fresh = key(), foreign = 'exports/manual-backup.pdf', gone = key();
    for (const k of [recorded, orphan, fresh, foreign]) await storage.put(k, PDF, 'application/pdf');
    for (const k of [recorded, orphan, foreign]) await age(k, 2 * DAY);
    await record(recorded);
    const missing = await record(gone); // its file was never stored

    const r = await sweepStorage({ remove: false, graceMs: DAY });
    expect(r).toMatchObject({ files: 4, unrecognised: 1, orphans: 1, removed: 0, missing: 1, refused: false });
    for (const k of [recorded, orphan, fresh, foreign]) expect(await exists(k)).toBe(true);

    // Delete mode: only the old orphan goes. A recorded file, a fresh one (its request may still record it) and a file
    // this server did not name are all kept.
    const d = await sweepStorage({ remove: true, graceMs: DAY });
    expect(d).toMatchObject({ orphans: 1, removed: 1, missing: 1 });
    expect(await exists(orphan)).toBe(false);
    for (const k of [recorded, fresh, foreign]) expect(await exists(k)).toBe(true);
    await prisma.document.delete({ where: { id: missing.id } });
  });

  it('never removes a file that gains a record between the scan and the removal', async () => {
    const k = key();
    await storage.put(k, PDF, 'application/pdf');
    await age(k, 2 * DAY);
    // The re-check before removal finds the record (as if a slow request had just committed it).
    const findUnique = prisma.document.findUnique.bind(prisma.document);
    vi.spyOn(prisma.document, 'findUnique').mockImplementation((async (args: Parameters<typeof findUnique>[0]) => {
      await record(k);
      return findUnique(args);
    }) as never);
    const r = await sweepStorage({ remove: true, graceMs: DAY });
    expect(r.removed).toBe(0);
    expect(await exists(k)).toBe(true);
  });

  it('removes nothing when there are more orphans than a crash could leave (a restored database, a wrong bucket)', async () => {
    const keys = Array.from({ length: MAX_REMOVALS_PER_RUN + 1 }, () => key('proof_of_payment'));
    for (const k of keys) { await storage.put(k, PDF, 'application/pdf'); await age(k, 2 * DAY); }
    const r = await sweepStorage({ remove: true, graceMs: DAY });
    expect(r).toMatchObject({ refused: true, removed: 0 });
    expect(r.orphans).toBeGreaterThan(MAX_REMOVALS_PER_RUN);
    for (const k of keys.slice(0, 5)) expect(await exists(k)).toBe(true);
    for (const k of keys) await storage.remove(k);
  });
});

describe('outbox and shutdown', () => {
  beforeAll(resetDb);

  it('stops between messages when the process is stopping; unsent messages go back to the queue uncounted', async () => {
    await prisma.notification.deleteMany();
    await prisma.notification.createMany({ data: [1, 2, 3].map(i => ({ channel: 'EMAIL' as const, to: `p${i}@example.zm`, subject: 's', body: `m${i}` })) });
    const stopping = new AbortController();
    vi.spyOn(mailer, 'send').mockImplementation(async () => { stopping.abort(); }); // SIGTERM arrives during the first send
    expect(await processOutbox(25, 60_000, stopping.signal)).toBe(1);
    const rows = await prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.filter(n => n.status === 'SENT')).toHaveLength(1);
    expect(rows.filter(n => n.status === 'PENDING').map(n => n.attempts)).toEqual([0, 0]);
  });
});

describe('credit bureau', () => {
  beforeAll(resetDb);

  it('labels simulated reports as simulated', async () => {
    const m = await makeMember();
    const r = await (await as(m.email)).post('/portal/credit-checks', { nrc: '284512/11/1', purpose: 'NEW_LOAN', consent: true });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().simulated).toBe(true);
  });

  it('a bureau that does not answer fails the check with 503; nothing is recorded or counted', async () => {
    const m = await makeMember();
    vi.spyOn(bureau!, 'lookup').mockImplementation(() => new Promise(() => {})); // never answers
    const member = await as(m.email);
    const r = await member.post('/portal/credit-checks', { nrc: '284512/11/1', purpose: 'NEW_LOAN', consent: true });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('BUREAU_UNAVAILABLE');
    expect(await prisma.creditCheck.count({ where: { memberId: m.id } })).toBe(0);
    vi.restoreAllMocks();
    // The full daily allowance is still there.
    for (let i = 0; i < config.CREDIT_CHECKS_PER_DAY; i++) expect((await member.post('/portal/credit-checks', { nrc: `20000${i}/11/1`, purpose: 'NEW_LOAN', consent: true })).statusCode).toBe(200);
  });
});

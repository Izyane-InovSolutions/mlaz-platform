// Runtime behaviour: health probes, request ids, the last-resort error response, and the background job runner.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { getApp } from './helpers.js';

// The runner's jobs are replaced so their timing and failures can be controlled; the real ones are tested elsewhere.
const jobs = vi.hoisted(() => ({ outbox: vi.fn(), reconcile: vi.fn(), expire: vi.fn() }));
vi.mock('../src/services/notifications.js', async real => ({ ...(await real<object>()), processOutbox: jobs.outbox }));
vi.mock('../src/services/payments.js', async real => ({ ...(await real<object>()), reconcilePending: jobs.reconcile, expireStale: jobs.expire }));
const { startJobs } = await import('../src/jobs/runner.js');

afterEach(() => vi.restoreAllMocks());

describe('health probes', () => {
  it('reports live, and ready while the database answers', async () => {
    const app = await getApp();
    expect((await app.inject('/health/live')).json()).toEqual({ ok: true });
    const ready = await app.inject('/health');
    expect(ready.statusCode).toBe(200);
    expect(ready.json().ok).toBe(true);
  });

  it('reports not ready, without internals, when the database fails', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const res = await (await getApp()).inject('/health');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('NOT_READY');
    expect(res.body).not.toContain('ECONNREFUSED');
  });
});

describe('request ids', () => {
  it('gives every response an id, and keeps a well-formed one from a proxy in front', async () => {
    const app = await getApp();
    expect((await app.inject('/health/live')).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await app.inject({ url: '/health/live', headers: { 'x-request-id': 'lb-7f3a9c21' } });
    expect(kept.headers['x-request-id']).toBe('lb-7f3a9c21');
    // Anything else is replaced, so a client cannot write arbitrary text into every log line of its request.
    const replaced = await app.inject({ url: '/health/live', headers: { 'x-request-id': 'x {"level":60} forged' } });
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers an unexpected error with a generic message and the request id, never the details', async () => {
    const app = await buildApp();
    app.get('/boom', async () => { throw new Error('relation "secret_table" does not exist'); });
    try {
      const res = await app.inject('/boom');
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toEqual({ code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId: res.headers['x-request-id'] });
      expect(res.body).not.toMatch(/secret_table|at .*\.ts/);
    } finally {
      await app.close();
    }
  });
});

describe('background job runner', () => {
  const log = { info: vi.fn(), error: vi.fn() } as unknown as Parameters<typeof startJobs>[0];

  it('keeps running the other jobs when one fails', async () => {
    jobs.outbox.mockRejectedValueOnce(new Error('SMTP down'));
    jobs.reconcile.mockResolvedValueOnce({ checked: 0, settled: 0 });
    jobs.expire.mockResolvedValueOnce(0);
    const stop = startJobs(log);
    await vi.waitFor(() => expect(jobs.expire).toHaveBeenCalled());
    await stop();
    expect(jobs.reconcile).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ job: 'outbox' }), 'background job failed');
  });

  it('on stop, finishes the job in progress and starts no other', async () => {
    let finished = false;
    jobs.outbox.mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 300)); finished = true; });
    jobs.reconcile.mockClear();
    const stop = startJobs(log);
    await stop();
    expect(finished).toBe(true);
    expect(jobs.reconcile).not.toHaveBeenCalled();
  });
});

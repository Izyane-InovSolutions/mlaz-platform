import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { STAFF, as, bearer, getApp, login, makeMember, resetDb } from './helpers.js';

describe('authentication', () => {
  beforeAll(resetDb);

  it('rotates refresh tokens and revokes every session when an old one is replayed', async () => {
    const app = await getApp();
    const first = await login(STAFF.admin);
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const second = r1.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // Replaying the first (already rotated) token is treated as theft.
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: first.refreshToken } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: second.refreshToken } })).statusCode).toBe(401);
  });

  it('locks out a deactivated user immediately', async () => {
    const { accessToken } = await login(STAFF.comms);
    const admin = await as(STAFF.admin);
    const comms = await prisma.user.findUniqueOrThrow({ where: { email: STAFF.comms } });
    expect((await admin.patch(`/admin/staff/${comms.id}`, { active: false })).statusCode).toBe(200);
    expect((await (await getApp()).inject({ url: '/api/auth/me', headers: bearer(accessToken) })).statusCode).toBe(401);
    await admin.patch(`/admin/staff/${comms.id}`, { active: true });
  });

  it('keeps at least one active admin', async () => {
    const admin = await as(STAFF.admin);
    const me = await prisma.user.findUniqueOrThrow({ where: { email: STAFF.admin } });
    expect((await admin.patch(`/admin/staff/${me.id}`, { active: false })).statusCode).toBe(400);
  });

  it('does not reveal whether an email has an account', async () => {
    const app = await getApp();
    const known = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: STAFF.officer } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'nobody@example.zm' } });
    expect(known.statusCode).toBe(204);
    expect(unknown.statusCode).toBe(204);
  });
});

describe('role-based access', () => {
  beforeAll(resetDb);

  it.each([
    [STAFF.comms, 'GET', '/admin/payments', 403],
    [STAFF.comms, 'GET', '/admin/applications', 403],
    [STAFF.finance, 'GET', '/admin/staff', 403],
    [STAFF.officer, 'GET', '/admin/expenses', 403],
    [STAFF.officer, 'PUT', '/admin/settings/fees', 403],
    [STAFF.finance, 'GET', '/admin/payments', 200],
    [STAFF.comms, 'GET', '/admin/broadcasts/audiences', 200],
    [STAFF.officer, 'GET', '/admin/members', 200],
  ] as const)('%s %s %s → %i', async (email, method, url, status) => {
    const c = await as(email);
    const res = method === 'GET' ? await c.get(url) : await c.put(url, { joiningFee: 1, renewalWindowDays: 1 });
    expect(res.statusCode, res.body).toBe(status);
  });

  it('keeps members out of the console and inside their own records', async () => {
    const a = await makeMember();
    const b = await makeMember();
    const memberA = await as(a.email);
    expect((await memberA.get('/admin/dashboard')).statusCode).toBe(403);

    const pay = (await (await as(b.email)).post('/portal/dues/payments', { method: 'BANK_TRANSFER' }));
    // B's dues are not payable yet (validUntil a year away), so create B's payment directly.
    expect(pay.statusCode).toBe(409);
    const p = await prisma.payment.create({ data: { ref: 'PAY-X1', purpose: 'DUES', memberId: b.id, payerName: b.name, amount: 1, method: 'CASH', provider: 'manual' } });
    expect((await memberA.get(`/portal/payments/${p.ref}`)).statusCode).toBe(404);
  });

  it('keeps staff out of the member portal', async () => {
    expect((await (await as(STAFF.admin)).get('/portal/overview')).statusCode).toBe(403);
  });
});

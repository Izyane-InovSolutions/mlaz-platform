import { beforeAll, describe, expect, it } from 'vitest';
import { runNightly } from '../src/jobs/runner.js';
import { currentStep, totpAt } from '../src/lib/crypto.js';
import { addDays, isoDate, today } from '../src/lib/dates.js';
import { prisma } from '../src/lib/db.js';
import { processOutbox } from '../src/services/notifications.js';
import { reconcilePending } from '../src/services/payments.js';
import { PASSWORD, PDF, STAFF, as, bearer, form, getApp, login, makeMember, refreshWith, resetDb, tokenFromEmail } from './helpers.js';

const post = async (url: string, payload: object, headers: Record<string, string> = {}) => (await getApp()).inject({ method: 'POST', url: `/api${url}`, payload, headers });
const me = async (token: string) => (await getApp()).inject({ url: '/api/auth/me', headers: bearer(token) });

describe('sessions and cookies', () => {
  beforeAll(resetDb);

  it('keeps the refresh token out of the response body and in a locked-down cookie', async () => {
    const res = await post('/auth/login', { email: STAFF.officer, password: PASSWORD });
    expect(res.json().refreshToken).toBeUndefined();
    const c = res.cookies.find(x => x.name === 'mlaz_rt')!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/auth' });
    expect(c.maxAge).toBeUndefined(); // not "remember me": ends with the browser session
    const remembered = (await post('/auth/login', { email: STAFF.officer, password: PASSWORD, remember: true })).cookies.find(x => x.name === 'mlaz_rt')!;
    expect(remembered.maxAge).toBeGreaterThan(86400);
  });

  it('refuses cookie refreshes without the anti-CSRF header or from a foreign origin', async () => {
    const { refreshToken } = await login(STAFF.officer);
    expect((await refreshWith(refreshToken, {})).json().error.code).toBe('CSRF');
    expect((await refreshWith(refreshToken, { 'x-mlaz-csrf': '1', origin: 'https://evil.example' })).json().error.code).toBe('BAD_ORIGIN');
    expect((await refreshWith(refreshToken, { 'x-mlaz-csrf': '1', origin: 'http://localhost:5173' })).statusCode).toBe(200);
  });

  it('ends every session when the password changes', async () => {
    const other = await login(STAFF.finance);
    const mine = await login(STAFF.finance);
    const res = await (await getApp()).inject({ method: 'POST', url: '/api/auth/password/change', headers: bearer(mine.accessToken), payload: { currentPassword: PASSWORD, newPassword: 'Another#Secret42' } });
    expect(res.statusCode, res.body).toBe(200);
    expect((await me(other.accessToken)).statusCode).toBe(401);
    expect((await refreshWith(other.refreshToken)).statusCode).toBe(401);
    expect((await me(res.json().accessToken)).statusCode).toBe(200);
  });

  it('signs out everywhere on request', async () => {
    const a = await login(STAFF.comms), b = await login(STAFF.comms);
    expect((await (await getApp()).inject({ method: 'POST', url: '/api/auth/logout-all', headers: bearer(a.accessToken) })).statusCode).toBe(204);
    for (const s of [a, b]) expect((await me(s.accessToken)).statusCode).toBe(401);
  });

  it('refuses weak passwords and passwords built from the email name', async () => {
    const s = await login(STAFF.officer);
    const change = async (newPassword: string) => (await getApp()).inject({ method: 'POST', url: '/api/auth/password/change', headers: bearer(s.accessToken), payload: { currentPassword: PASSWORD, newPassword } });
    expect((await change('password1234')).statusCode).toBe(400);
    expect((await change('aaaaaaaaaaaa')).statusCode).toBe(400);
    expect((await change('officer-Strong-2026')).statusCode).toBe(400);
  });

  it('makes an older reset link useless once a newer one is sent, and each link single-use', async () => {
    await post('/auth/password/forgot', { email: STAFF.officer });
    const first = await tokenFromEmail(STAFF.officer);
    await post('/auth/password/forgot', { email: STAFF.officer });
    const second = await tokenFromEmail(STAFF.officer);
    expect(first).not.toBe(second);
    expect((await post('/auth/password/set', { token: first, password: 'Fresh#Password77' })).statusCode).toBe(400);
    expect((await post('/auth/password/set', { token: second, password: 'Fresh#Password77' })).statusCode).toBe(200);
    expect((await post('/auth/password/set', { token: second, password: 'Fresh#Password78' })).statusCode).toBe(400);
  });
});

describe('brute-force protection', () => {
  beforeAll(resetDb);

  it('locks an email after 5 failures, whether or not the account exists', async () => {
    for (const email of ['nobody@example.zm', STAFF.comms]) {
      for (let i = 0; i < 5; i++) expect((await post('/auth/login', { email, password: 'wrong-password' })).statusCode).toBe(401);
      const locked = await post('/auth/login', { email, password: email === STAFF.comms ? PASSWORD : 'x' });
      expect(locked.statusCode).toBe(429);
      expect(locked.json().error.code).toBe('TOO_MANY_ATTEMPTS');
    }
  });

  it('ignores X-Forwarded-For unless a proxy is configured, so rate limits and audit IPs cannot be spoofed', async () => {
    await post('/auth/login', { email: STAFF.officer, password: PASSWORD }, { 'x-forwarded-for': '6.6.6.6' });
    const entry = await prisma.auditLog.findFirst({ where: { action: 'Signed in' }, orderBy: { at: 'desc' } });
    expect(entry?.ip).toBeTruthy();
    expect(entry?.ip).not.toBe('6.6.6.6');
  });
});

describe('two-factor sign-in', () => {
  beforeAll(resetDb);
  let codes: string[] = [];
  let secret = '';

  it('enrols with a confirmed code and returns one-time recovery codes', async () => {
    const admin = await as(STAFF.admin);
    const setup = await admin.post('/auth/mfa/setup');
    expect(setup.statusCode).toBe(200);
    secret = setup.json().secret;
    expect(setup.json().otpauthUrl).toContain('otpauth://totp/');
    expect((await admin.post('/auth/mfa/confirm', { code: '000000' })).statusCode).toBe(400);
    const ok = await admin.post('/auth/mfa/confirm', { code: totpAt(secret, currentStep()) });
    expect(ok.statusCode, ok.body).toBe(200);
    codes = ok.json().recoveryCodes;
    expect(codes).toHaveLength(8);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: STAFF.admin } });
    expect(stored.totpSecret).not.toContain(secret); // encrypted at rest
    expect(stored.recoveryCodes).not.toContain(codes[0]); // hashed
  });

  it('requires the second factor, refuses a replayed code, and accepts a recovery code once', async () => {
    const step1 = await post('/auth/login', { email: STAFF.admin, password: PASSWORD });
    expect(step1.json()).toMatchObject({ mfaRequired: true });
    expect(step1.json().accessToken).toBeUndefined();
    expect(step1.cookies.find(c => c.name === 'mlaz_rt')).toBeUndefined();
    const { mfaToken } = step1.json();

    // The intermediate token is not an access token.
    expect((await (await getApp()).inject({ url: '/api/admin/dashboard', headers: bearer(mfaToken) })).statusCode).toBe(401);

    expect((await post('/auth/login/mfa', { mfaToken, code: '123456' })).statusCode).toBe(401);
    // The code used to confirm enrolment (same time step) cannot be used again.
    expect((await post('/auth/login/mfa', { mfaToken, code: totpAt(secret, currentStep()) })).statusCode).toBe(401);

    const rc = await post('/auth/login/mfa', { mfaToken, code: codes[0] });
    expect(rc.statusCode, rc.body).toBe(200);
    expect((await post('/auth/login/mfa', { mfaToken, code: codes[0] })).statusCode).toBe(401);
  });

  it('lets an admin reset a colleague’s lost second factor, ending their sessions', async () => {
    const officer = await as(STAFF.officer);
    const enrol = await officer.post('/auth/mfa/setup');
    await officer.post('/auth/mfa/confirm', { code: totpAt(enrol.json().secret, currentStep()) });
    const officerUser = await prisma.user.findUniqueOrThrow({ where: { email: STAFF.officer } });
    expect(officerUser.totpEnabledAt).not.toBeNull();
    // The officer's existing session (from `as`) is still live until the reset.
    const officerProbe = await officer.get('/auth/me');
    expect(officerProbe.statusCode).toBe(200);

    const step = (await post('/auth/login', { email: STAFF.admin, password: PASSWORD })).json();
    const adminSession = (await post('/auth/login/mfa', { mfaToken: step.mfaToken, code: codes[1] })).json();
    const res = await (await getApp()).inject({ method: 'PATCH', url: `/api/admin/staff/${officerUser.id}`, headers: bearer(adminSession.accessToken), payload: { resetMfa: true } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().mfaEnabled).toBe(false);
    expect((await officer.get('/auth/me')).statusCode).toBe(401);
  });
});

describe('least privilege and data integrity', () => {
  beforeAll(resetDb);

  it('stops members renaming their business or changing registered details', async () => {
    const m = await makeMember();
    const member = await as(m.email);
    expect((await member.patch('/portal/profile', { name: 'A Famous Lender Ltd' })).statusCode).toBe(400);
    const ok = await member.patch('/portal/profile', { contactPhone: '0971112223' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).name).toBe(m.name);
  });

  it('closes credit-bureau access and event registration to members not in good standing', async () => {
    const m = await makeMember({ validUntil: addDays(today(), -2) });
    await runNightly(); // lapses the member
    const member = await as(m.email);
    expect((await member.post('/portal/credit-checks', { nrc: '284512/11/1', purpose: 'NEW_LOAN', consent: true })).statusCode).toBe(403);
    const e = (await (await as(STAFF.comms)).post('/admin/events', { name: 'Members only', type: 'TRAINING', date: isoDate(addDays(today(), 10)), venue: 'Lusaka', capacity: 10, price: 0 })).json();
    expect((await member.post(`/portal/events/${e.id}/registrations`, { tickets: 1 })).json().error.code).toBe('MEMBERSHIP_NOT_ACTIVE');
  });

  it('hides application and money data from roles that cannot open them', async () => {
    const res = await (await getApp()).inject({ method: 'POST', url: '/api/public/applications', payload: form({ name: 'Hidden Lender', pacra: '120260011111', tpin: '1001111111', town: 'Lusaka', province: 'Lusaka', tier: 'Silver', contact: 'X Y', position: 'Director', phone: '0977000001', email: 'hidden@example.zm', director: 'X Y', directorNrc: '111111/11/1', declare: 'true' }, { pacraFile: PDF, nrcFile: PDF }) });
    expect(res.statusCode, res.body).toBe(201);
    const comms = await as(STAFF.comms);
    expect((await comms.get('/admin/search?q=Hidden')).json().applications).toHaveLength(0);
    const d = (await comms.get('/admin/dashboard')).json();
    expect(d.pipeline).toHaveLength(0);
    expect(d.stats.collectedYtd).toBeNull();
    expect((await (await as(STAFF.officer)).get('/admin/search?q=Hidden')).json().applications).toHaveLength(1);
  });

  it('serves uploaded documents as sandboxed attachments that are never cached', async () => {
    const doc = await prisma.document.findFirstOrThrow();
    const res = await (await as(STAFF.officer)).get(`/admin/documents/${doc.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('marks personal-data responses no-store and does not echo URLs in 404s', async () => {
    expect((await (await as(STAFF.officer)).get('/admin/members')).headers['cache-control']).toBe('no-store');
    const nf = await (await getApp()).inject({ url: '/api/%3Cscript%3Enope' });
    expect(nf.statusCode).toBe(404);
    expect(nf.body).not.toContain('script');
  });

  it('rejects control characters in text fields', async () => {
    expect((await (await as(STAFF.comms)).post('/admin/announcements', { title: 'Hi\u0000there', body: 'x', tag: 'Notice' })).statusCode).toBe(400);
  });

  it('only allows staff accounts on the MLAZ email domain', async () => {
    expect((await (await as(STAFF.admin)).post('/admin/staff', { email: 'someone@gmail.com', name: 'Outsider', role: 'ADMIN' })).statusCode).toBe(400);
  });

  it('can deactivate a member’s portal user, ending their session at once', async () => {
    const m = await makeMember();
    const { accessToken } = await login(m.email);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: m.email } });
    expect((await (await as(STAFF.officer)).patch(`/admin/members/${m.number}/users/${u.id}`, { active: false })).statusCode).toBe(204);
    expect((await (await getApp()).inject({ url: '/api/portal/overview', headers: bearer(accessToken) })).statusCode).toBe(401);
  });
});

describe('operations', () => {
  beforeAll(resetDb);

  it('scrubs one-time links from delivered messages and never lists message bodies', async () => {
    await post('/auth/password/forgot', { email: STAFF.officer });
    const list = (await (await as(STAFF.admin)).get('/admin/notifications?status=PENDING')).json();
    expect(list.length).toBeGreaterThan(0);
    for (const n of list) expect(n.body).toBeUndefined();
    await processOutbox();
    const sent = await prisma.notification.findFirstOrThrow({ where: { to: STAFF.officer, subject: { contains: 'Reset' } } });
    expect(sent.status).toBe('SENT');
    expect(sent.body).toContain('token=[redacted]');
  });

  it('records a refund on a cancelled paid event exactly once, and only by Finance', async () => {
    const comms = await as(STAFF.comms);
    const e = (await comms.post('/admin/events', { name: 'Refund test', type: 'AGM', date: isoDate(addDays(today(), 20)), venue: 'Lusaka', capacity: 10, price: 300 })).json();
    const m = await makeMember();
    await (await as(m.email)).post(`/portal/events/${e.id}/registrations`, { tickets: 1, method: 'MTN_MOMO', msisdn: '0977123456' });
    await reconcilePending();
    await comms.post(`/admin/events/${e.id}/cancel`, { reason: 'Postponed.' });
    const reg = await prisma.registration.findFirstOrThrow({ where: { eventId: e.id } });
    expect(reg.refundDue).toBe(true);
    expect((await comms.post(`/admin/events/registrations/${reg.id}/refund`, { reference: 'x' })).statusCode).toBe(403);
    const finance = await as(STAFF.finance);
    expect((await finance.post(`/admin/events/registrations/${reg.id}/refund`, { reference: 'MOMO-REF-1' })).statusCode).toBe(204);
    expect((await finance.post(`/admin/events/registrations/${reg.id}/refund`, { reference: 'MOMO-REF-1' })).statusCode).toBe(409);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).toMatchObject({ refundDue: false, refundRef: 'MOMO-REF-1' });
  });
});

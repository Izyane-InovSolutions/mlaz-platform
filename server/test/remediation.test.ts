// Regression tests for the security audit findings (M1-M4, L1-L9). Each test attacks the original weakness.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { config, productionProblems } from '../src/config.js';
import { SYSTEM } from '../src/lib/audit.js';
import { currentStep, totpAt } from '../src/lib/crypto.js';
import { addDays, isoDate, today } from '../src/lib/dates.js';
import { prisma } from '../src/lib/db.js';
import { logLineFor } from '../src/providers/messaging.js';
import { RESET_MIN_MS } from '../src/services/accounts.js';
import * as applications from '../src/services/applications.js';
import { settle } from '../src/services/payments.js';
import { PASSWORD, PDF, STAFF, as, form, getApp, makeMember, resetDb, tempUpload } from './helpers.js';

const applicant = {
  name: 'Kasama Credit Ltd', pacra: '120260007777', tpin: '1007777777', town: 'Kasama', province: 'Northern', address: 'Plot 3',
  tier: 'Bronze', contact: 'Bupe Chola', position: 'Director', phone: '0977000777', email: 'bupe@kasamacredit.zm',
  director: 'Bupe Chola', directorNrc: '123456/78/1', declare: 'true',
};
let seq = 0;
/** A fresh applicant (unique TPIN, PACRA and email), without the MoF document so the application waits in DETAILS. */
async function submitApplication(files: Record<string, Buffer> = { pacraFile: PDF, nrcFile: PDF }) {
  seq++;
  const fields = { ...applicant, tpin: String(1007777700 + seq), pacra: String(120260007700 + seq), email: `app${seq}@kasamacredit.zm`, phone: `09770007${String(seq).padStart(2, '0')}` };
  return (await getApp()).inject({ method: 'POST', url: '/api/public/applications', payload: form(fields, files) });
}

const STORAGE = path.resolve(process.env.STORAGE_DIR ?? './storage-test');
function storedFileCount(dir = STORAGE): number {
  try {
    return readdirSync(dir).reduce((n, f) => { const p = path.join(dir, f); return n + (statSync(p).isDirectory() ? storedFileCount(p) : 1); }, 0);
  } catch {
    return 0;
  }
}

const login = async (email: string, password: string, remoteAddress: string) =>
  (await getApp()).inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, remoteAddress });

/* ================= M1, M2, L8: production configuration ================= */

describe('production start-up checks (M1, M2, L8)', () => {
  const strong = { ...config, JWT_SECRET: 'Zq8#vW2p!Lr5tY9u@Kx3bN7m$Hc4jD6f', WEBHOOK_SECRET: 'Pa7&Qs1!Dw9^Er3*Ty5(Ui8)Op2_Lk4m', DATA_ENCRYPTION_KEY: 'Mn3$Bv6%Cx9&Za2*Sd5(Fg8)Hj1!Kl4q', ALLOW_SANDBOX_IN_PRODUCTION: true, COOKIE_SECURE: true, CORS_ORIGINS: ['https://app.mlaz.org.zm'], PUBLIC_APP_URL: 'https://app.mlaz.org.zm' };

  it('refuses to start without SMTP, without required staff 2FA, or without an explicit proxy setting', () => {
    const problems = productionProblems({ ...strong, SMTP_URL: '', REQUIRE_STAFF_2FA: false }, {}).join('\n');
    expect(problems).toContain('SMTP_URL');
    expect(problems).toContain('REQUIRE_STAFF_2FA');
    expect(problems).toContain('TRUST_PROXY_HOPS');
  });

  it('accepts a correctly configured production server', () => {
    expect(productionProblems({ ...strong, SMTP_URL: 'smtps://user:pw@smtp.example.zm', REQUIRE_STAFF_2FA: true }, { TRUST_PROXY_HOPS: '1' })).toEqual([]);
    expect(productionProblems({ ...strong, SMTP_URL: 'smtps://user:pw@smtp.example.zm', REQUIRE_STAFF_2FA: true }, { TRUST_PROXY_HOPS: '0' })).toEqual([]);
  });

  it('never prints one-time links when email or SMS is only logged', () => {
    const line = logLineFor('email', 'x@example.zm', 'Reset | Use this link: https://app/#/set-password?token=SECRETtoken_123-abc and track https://app/#/track/APP-1?t=TrackTok_9-z');
    expect(line).not.toContain('SECRETtoken_123-abc');
    expect(line).not.toContain('TrackTok_9-z');
    expect(line).toContain('token=[redacted]');
    expect(line).toContain('t=[redacted]');
  });
});

/* ================= M3: event cancelled while a payment is in flight ================= */

describe('late payments for cancelled events (M3)', () => {
  beforeAll(resetDb);

  it('records a payment approved after the event was cancelled, and flags it for refund', async () => {
    const comms = await as(STAFF.comms);
    const e = (await comms.post('/admin/events', { name: 'Cancelled mid-payment', type: 'TRAINING', date: isoDate(addDays(today(), 20)), venue: 'Lusaka', capacity: 10, price: 300 })).json();
    const m = await makeMember();
    const reg = await (await as(m.email)).post(`/portal/events/${e.id}/registrations`, { tickets: 1, method: 'MTN_MOMO', msisdn: '0977123456' });
    expect(reg.statusCode, reg.body).toBe(201);
    expect((await comms.post(`/admin/events/${e.id}/cancel`, { reason: 'Facilitator unavailable.' })).statusCode).toBe(204);

    const p = await prisma.payment.findFirstOrThrow({ where: { registration: { eventId: e.id } } });
    expect(p).toMatchObject({ status: 'CANCELLED', failureReason: 'Event cancelled' });

    // The member approves the prompt on their phone after the cancellation: the money was taken.
    await settle(p.id, { status: 'SUCCESS' }, SYSTEM);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('SUCCESS');
    expect(await prisma.registration.findFirstOrThrow({ where: { eventId: e.id } })).toMatchObject({ status: 'CANCELLED', refundDue: true });
    expect(await prisma.auditLog.count({ where: { action: 'Refund due', note: { contains: p.ref } } })).toBe(1);
  });
});

/* ================= M4 and L6: concurrency ================= */

describe('concurrent requests (M4, L6)', () => {
  beforeAll(resetDb);

  it('never exceeds the daily credit-check cap, however many checks run at once', async () => {
    const m = await makeMember();
    const member = await as(m.email);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => member.post('/portal/credit-checks', { nrc: `20000${i}/11/1`, purpose: 'NEW_LOAN', consent: true })));
    const codes = results.map(r => r.statusCode);
    expect(codes.filter(c => c === 200)).toHaveLength(config.CREDIT_CHECKS_PER_DAY);
    expect(codes.filter(c => c === 429)).toHaveLength(8 - config.CREDIT_CHECKS_PER_DAY);
    expect(await prisma.creditCheck.count({ where: { memberId: m.id } })).toBe(config.CREDIT_CHECKS_PER_DAY);
  });

  it('creates one dues payment when "pay" is pressed twice at once', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 5) });
    const member = await as(m.email);
    const [a, b] = await Promise.all([1, 2].map(() => member.post('/portal/dues/payments', { method: 'MTN_MOMO', msisdn: '0977123456' })));
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect([a, b].find(r => r.statusCode === 409)!.json().error.code).toBe('PAYMENT_IN_PROGRESS');
    expect(await prisma.payment.count({ where: { memberId: m.id, purpose: 'DUES' } })).toBe(1);
  });

  it('does not reopen a rejected application when its MoF upload finishes afterwards', async () => {
    const { ref } = (await submitApplication()).json();
    const stale = await prisma.application.findUniqueOrThrow({ where: { ref } }); // loaded before the slow upload
    expect(stale.stage).toBe('DETAILS');
    expect((await (await as(STAFF.admin)).post(`/admin/applications/${ref}/reject`, { reason: 'Not a money lender.' })).statusCode).toBe(200);
    const before = storedFileCount();

    await expect(applications.uploadMof(stale, 'MoF/ML/2026/1', await tempUpload('mofFile', 'mof.pdf', PDF), '127.0.0.1')).rejects.toMatchObject({ status: 409 });
    expect((await prisma.application.findUniqueOrThrow({ where: { ref } })).stage).toBe('REJECTED');
    expect(await prisma.document.count({ where: { applicationId: stale.id, kind: 'MOF_AUTHORIZATION' } })).toBe(0);
    expect(storedFileCount()).toBe(before); // the uploaded file was removed again
  });

  it('does not start a payment for an application rejected in the meantime', async () => {
    const { ref } = (await submitApplication()).json();
    await prisma.application.update({ where: { ref }, data: { stage: 'PAYMENT_PENDING' } });
    const stale = await prisma.application.findUniqueOrThrow({ where: { ref } });
    expect((await (await as(STAFF.admin)).post(`/admin/applications/${ref}/reject`, { reason: 'Withdrawn.' })).statusCode).toBe(200);
    await expect(applications.startPayment(stale, { method: 'MTN_MOMO', msisdn: '0977123456' })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.payment.count({ where: { applicationId: stale.id } })).toBe(0);
  });
});

/* ================= L1: tier names ================= */

describe('tier names (L1)', () => {
  beforeAll(resetDb);

  it('refuses tier names that could break out of the console markup', async () => {
    const admin = await as(STAFF.admin);
    for (const bad of [`x');alert(1);//`, '<img src=x onerror=alert(1)>', 'a"b']) {
      const res = await admin.put(`/admin/settings/tiers/${encodeURIComponent(bad)}`, { annualDues: 100 });
      expect(res.statusCode, bad).toBe(400);
    }
    expect(await prisma.tier.count({ where: { OR: [{ name: { contains: 'alert' } }, { name: { contains: '"' } }] } })).toBe(0);
    expect((await admin.put(`/admin/settings/tiers/${encodeURIComponent('Platinum Plus')}`, { annualDues: 6000 })).statusCode).toBe(200);
  });
});

/* ================= L2, L9: password brute force and enumeration ================= */

describe('password throttling (L2) and reset timing (L9)', () => {
  beforeAll(resetDb);

  it('locks out the guessing address without locking the real user out from elsewhere', async () => {
    for (let i = 0; i < 5; i++) expect((await login(STAFF.comms, 'wrong-password', '10.0.0.66')).statusCode).toBe(401);
    expect((await login(STAFF.comms, PASSWORD, '10.0.0.66')).statusCode).toBe(429);
    expect((await login(STAFF.comms, PASSWORD, '10.0.0.7')).statusCode).toBe(200);
  });

  // Phase 3 replaced the account-wide lock (which let anyone with six addresses lock a user out) with a challenge:
  // guesses spread over many addresses are still caught, but the real user can always get in with an emailed code.
  it('meets guesses spread over many addresses with an emailed code, not a lock-out', async () => {
    for (let ip = 1; ip <= 6; ip++) {
      for (let i = 0; i < 5; i++) expect((await login(STAFF.finance, 'wrong-password', `10.1.0.${ip}`)).statusCode).toBe(401);
    }
    const res = await login(STAFF.finance, PASSWORD, '10.1.0.99');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mfaRequired: true, method: 'email' });
    expect(res.json().accessToken).toBeUndefined();
  });

  it('answers a reset request no faster for an unknown email than for a real one', async () => {
    for (const email of ['nobody-here@example.zm', STAFF.officer]) {
      const started = Date.now();
      const res = await (await getApp()).inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email } });
      expect(res.statusCode).toBe(204);
      expect(Date.now() - started).toBeGreaterThanOrEqual(RESET_MIN_MS - 5);
    }
  });
});

/* ================= L3: second factor for sensitive changes ================= */

describe('second-factor checks for account changes (L3)', () => {
  let admin: Awaited<ReturnType<typeof as>>;
  let secret = '';

  beforeAll(async () => {
    await resetDb();
    admin = await as(STAFF.admin);
    secret = (await admin.post('/auth/mfa/setup')).json().secret;
    expect((await admin.post('/auth/mfa/confirm', { code: totpAt(secret, currentStep()) })).statusCode).toBe(200);
  });

  it('accepts a code only once, even when it is sent twice at the same moment', async () => {
    const code = totpAt(secret, currentStep() + 1);
    const [a, b] = await Promise.all([1, 2].map(() => admin.post('/auth/mfa/recovery-codes', { code })));
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
  });

  it('locks after repeated wrong codes, so codes cannot be guessed with a stolen session', async () => {
    await prisma.loginThrottle.deleteMany();
    for (let i = 0; i < 5; i++) expect((await admin.post('/auth/mfa/recovery-codes', { code: '000000' })).statusCode).toBe(400);
    expect((await admin.post('/auth/mfa/recovery-codes', { code: totpAt(secret, currentStep()) })).statusCode).toBe(429);
    expect((await admin.post('/auth/mfa/disable', { password: PASSWORD, code: totpAt(secret, currentStep()) })).statusCode).toBe(429);
  });
});

/* ================= L4: partial updates ================= */

describe('partial updates keep the fields they leave out (L4)', () => {
  beforeAll(resetDb);

  it('does not reset a loan in arrears to current, or blank its phone, when only the balance changes', async () => {
    const m = await makeMember();
    const member = await as(m.email);
    const loan = (await member.post('/portal/loans', { borrowerNrc: '284512/11/1', borrowerName: 'K. Phiri', borrowerPhone: '0977555111', amount: 5000, balance: 4000, status: 'ARREARS', issuedAt: isoDate(addDays(today(), -30)) })).json();
    const res = await member.patch(`/portal/loans/${loan.id}`, { balance: 3500 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ balance: 3500, status: 'ARREARS', borrowerPhone: '0977555111' });
  });

  it('does not blank an event description when another field is edited', async () => {
    const comms = await as(STAFF.comms);
    const e = (await comms.post('/admin/events', { name: 'Described event', type: 'WEBINAR', date: isoDate(addDays(today(), 10)), venue: 'Online', capacity: 5, price: 0, description: 'Agenda: compliance update.' })).json();
    expect((await comms.patch(`/admin/events/${e.id}`, { capacity: 8 })).json()).toMatchObject({ capacity: 8, description: 'Agenda: compliance update.' });
  });
});

/* ================= L5, L7 and multipart hardening ================= */

describe('webhook routing, uploads and multipart parsing (L5, L7)', () => {
  beforeAll(resetDb);

  it('answers 404, not 500, for provider names that are Object members', async () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
      const res = await (await getApp()).inject({ method: 'POST', url: `/api/webhooks/payments/${name}`, headers: { 'content-type': 'application/json' }, payload: '{}' });
      expect(res.statusCode, name).toBe(404);
    }
  });

  it('removes already-stored files when a later file in the same application is rejected', async () => {
    const before = storedFileCount();
    const res = await submitApplication({ pacraFile: PDF, nrcFile: Buffer.from('MZ not a document') });
    expect(res.statusCode).toBe(400);
    expect(storedFileCount()).toBe(before);
  });

  it('removes the stored file when the record cannot be written', async () => {
    const m = await makeMember();
    const member = await as(m.email);
    expect((await member.multipart('/portal/mof-renewals', form({ mofRef: 'MoF/ML/2027/1' }, { file: PDF }))).statusCode).toBe(201);
    const before = storedFileCount();
    const second = await member.multipart('/portal/mof-renewals', form({ mofRef: 'MoF/ML/2027/2' }, { file: PDF }));
    expect(second.json().error.code).toBe('RENEWAL_PENDING');
    expect(storedFileCount()).toBe(before);
  });

  it('refuses a multipart part named __proto__', async () => {
    // Object.fromEntries makes "__proto__" an own key (an object literal would set the prototype instead).
    // @fastify/multipart rejects it; readMultipart's prototype-free maps are a second line of defence.
    const res = await submitApplication(Object.fromEntries([['pacraFile', PDF], ['nrcFile', PDF], ['__proto__', PDF]]));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FST_PROTO_VIOLATION');
  });
});

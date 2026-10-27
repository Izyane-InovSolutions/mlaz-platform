import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoDate, today } from '../src/lib/dates.js';
import { prisma } from '../src/lib/db.js';
import { reconcilePending } from '../src/services/payments.js';
import { STAFF, as, makeMember, resetDb } from './helpers.js';

describe('events', () => {
  beforeAll(resetDb);
  const date = isoDate(addDays(today(), 30));

  it('never sells more places than the capacity', async () => {
    const comms = await as(STAFF.comms);
    const e = (await comms.post('/admin/events', { name: 'Small workshop', type: 'TRAINING', date, venue: 'Lusaka', capacity: 3, price: 0 })).json();
    const [a, b] = [await makeMember(), await makeMember()];
    expect((await (await as(a.email)).post(`/portal/events/${e.id}/registrations`, { tickets: 2 })).statusCode).toBe(201);
    const full = await (await as(b.email)).post(`/portal/events/${e.id}/registrations`, { tickets: 2 });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('EVENT_FULL');
    expect((await (await as(b.email)).post(`/portal/events/${e.id}/registrations`, { tickets: 1 })).statusCode).toBe(201);
    expect((await (await as(a.email)).post(`/portal/events/${e.id}/registrations`, { tickets: 1 })).json().error.code).toBe('ALREADY_REGISTERED');
    // Capacity cannot drop below what is already taken.
    expect((await comms.patch(`/admin/events/${e.id}`, { capacity: 2 })).statusCode).toBe(400);
  });

  it('holds places during payment and releases them if the payment fails', async () => {
    const comms = await as(STAFF.comms);
    const e = (await comms.post('/admin/events', { name: 'Paid briefing', type: 'WEBINAR', date, venue: 'Online', capacity: 2, price: 250 })).json();
    const m = await makeMember();
    const member = await as(m.email);
    const reg = await member.post(`/portal/events/${e.id}/registrations`, { tickets: 2, method: 'MTN_MOMO', msisdn: '0977000000' });
    expect(reg.statusCode, reg.body).toBe(201);
    expect(reg.json().payment).toMatchObject({ amount: 500, status: 'PENDING' });
    expect((await member.get(`/portal/events/${e.id}`)).json().placesLeft).toBe(0);

    await reconcilePending(); // number ending 0000 is declined by the sandbox
    expect((await member.get(`/portal/events/${e.id}`)).json()).toMatchObject({ placesLeft: 2, myRegistration: null });
  });

  it('confirms a paid registration and flags refunds when the event is cancelled', async () => {
    const comms = await as(STAFF.comms);
    const e = (await comms.post('/admin/events', { name: 'AGM test', type: 'AGM', date, venue: 'Lusaka', capacity: 50, price: 500 })).json();
    const m = await makeMember();
    await (await as(m.email)).post(`/portal/events/${e.id}/registrations`, { tickets: 1, method: 'AIRTEL_MONEY', msisdn: '0961234567' });
    await reconcilePending();
    const detail = (await comms.get(`/admin/events/${e.id}`)).json();
    expect(detail).toMatchObject({ registered: 1, revenue: 500 });
    expect(detail.registrations[0].status).toBe('CONFIRMED');

    expect((await comms.post(`/admin/events/${e.id}/cancel`, { reason: 'Venue unavailable.' })).statusCode).toBe(204);
    const reg = await prisma.registration.findFirstOrThrow({ where: { eventId: e.id } });
    expect(reg).toMatchObject({ status: 'CANCELLED', refundDue: true });
    expect(await prisma.notification.count({ where: { to: m.email, subject: { startsWith: 'Cancelled' } } })).toBe(1);
  });
});

describe('broadcasts', () => {
  beforeAll(resetDb);

  it('queues email and SMS for the chosen audience and posts to the portal', async () => {
    await makeMember({ tier: 'Gold' });
    await makeMember({ tier: 'Gold' });
    await makeMember({ tier: 'Silver' });
    const comms = await as(STAFF.comms);
    const res = await comms.post('/admin/broadcasts', { subject: 'Gold members briefing', body: 'Details inside.', audience: 'TIER:Gold', channels: ['EMAIL', 'SMS', 'PORTAL'] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().recipientCount).toBe(2);
    expect(await prisma.notification.count({ where: { broadcastId: res.json().id } })).toBe(4);
    expect(await prisma.announcement.count({ where: { title: 'Gold members briefing' } })).toBe(1);
  });
});

describe('credit checks', () => {
  beforeAll(resetDb);

  it('requires the borrower’s consent and logs every check', async () => {
    const m = await makeMember();
    const member = await as(m.email);
    const loan = await member.post('/portal/loans', { borrowerNrc: '284512/11/1', borrowerName: 'J. Kapenda', amount: 5000, balance: 3000, issuedAt: isoDate(addDays(today(), -10)) });
    expect(loan.statusCode, loan.body).toBe(201);

    const noConsent = await member.post('/portal/credit-checks', { nrc: '284512/11/1', purpose: 'NEW_LOAN', consent: false });
    expect(noConsent.statusCode).toBe(400);

    const ok = await member.post('/portal/credit-checks', { nrc: '284512/11/1', purpose: 'NEW_LOAN', consent: true });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().yourLoans).toHaveLength(1);
    const audited = await prisma.auditLog.findFirst({ where: { target: m.number, action: 'Credit check' } });
    expect(audited?.note).toContain('284512/11/1');
    if (ok.json().found) expect((await member.get('/portal/loans')).json().items[0].score).toBe(ok.json().report.score);
  });

  it('shows the score from a recent check on a loan added afterwards', async () => {
    const m = await makeMember();
    const member = await as(m.email);
    let score: number | null = null;
    for (const nrc of ['284512/11/1', '320871/41/1']) {
      const r = (await member.post('/portal/credit-checks', { nrc, purpose: 'NEW_LOAN', consent: true })).json();
      if (r.found) {
        score = r.report.score;
        await member.post('/portal/loans', { borrowerNrc: nrc, borrowerName: 'Later Loan', amount: 1000, balance: 1000, issuedAt: isoDate(addDays(today(), -1)) });
        break;
      }
    }
    expect(score).not.toBeNull();
    expect((await member.get('/portal/loans')).json().items[0].score).toBe(score);
  });

  it('enforces the daily limit', async () => {
    const m = await makeMember();
    const member = await as(m.email);
    for (let i = 0; i < 3; i++) expect((await member.post('/portal/credit-checks', { nrc: `10000${i}/11/1`, purpose: 'NEW_LOAN', consent: true })).statusCode).toBe(200);
    expect((await member.post('/portal/credit-checks', { nrc: '100009/11/1', purpose: 'NEW_LOAN', consent: true })).statusCode).toBe(429);
  });
});

describe('reports', () => {
  beforeAll(resetDb);

  it('exports CSV with formula injection neutralised', async () => {
    await makeMember();
    await prisma.member.updateMany({ data: { name: '=HYPERLINK("http://evil")' } });
    const res = await (await as(STAFF.admin)).get('/admin/reports/register?format=csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

// Background job reliability: one reconciliation at a time across instances (D9), and dues/MoF reminders that survive
// missed or failed nights without ever going out twice (D6). Against the real database, like the other API tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNightly, runReconcile } from '../src/platform/jobs/scheduler.js';
import { SYSTEM } from '../src/shared/actor.js';
import { addDays, addYears, isoDate, today, todayIso } from '../src/shared/dates.js';
import { prisma } from '../src/shared/db.js';
import { acquireLease } from '../src/platform/jobs/leases.js';
import { gateway } from '../src/modules/payments/infrastructure/gateways.js';
import { dueReminder, sendReminders } from '../src/modules/membership/index.js';
import { reconcilePending, settle } from '../src/modules/payments/index.js';
import { as, makeMember, resetDb } from './helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ================= D9: reconciliation across instances ================= */

/** Members with a pending mobile money dues payment each, as the portal checkout leaves them. */
async function pendingDuesPayments(n: number) {
  const members = [];
  for (let i = 0; i < n; i++) {
    const m = await makeMember({ validUntil: addDays(today(), 20) });
    const res = await (await as(m.email)).post('/portal/dues/payments', { method: 'MTN_MOMO', msisdn: '0977123456' });
    expect(res.statusCode, res.body).toBe(201);
    members.push(m);
  }
  return members;
}

describe('distributed lease', () => {
  beforeEach(resetDb);

  it('is granted to exactly one of many instances racing for it', async () => {
    const leases = await Promise.all(Array.from({ length: 10 }, () => acquireLease('test.race', 60_000)));
    expect(leases.filter(Boolean)).toHaveLength(1);
  });

  it('is taken over once it expires (a crashed holder), and the old holder can then neither renew nor release it', async () => {
    const first = await acquireLease('test.expiry', 60_000);
    expect(first).not.toBeNull();
    expect(await acquireLease('test.expiry', 60_000)).toBeNull();
    // The holder crashes; its lease runs out.
    await prisma.jobLease.update({ where: { name: 'test.expiry' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const second = await acquireLease('test.expiry', 60_000);
    expect(second).not.toBeNull();

    expect(await first!.renew()).toBe(false); // the fence: the overrunning holder learns it lost the lease
    await first!.release();
    expect((await prisma.jobLease.findUniqueOrThrow({ where: { name: 'test.expiry' } })).owner).toBe(second!.owner);
    expect(await second!.renew()).toBe(true);
    await second!.release();
    expect(await prisma.jobLease.findUnique({ where: { name: 'test.expiry' } })).toBeNull();
  });
});

describe('payment reconciliation across instances', () => {
  beforeEach(resetDb);

  it('runs once when several instances try at the same moment: one gateway query per payment, each applied once', async () => {
    const members = await pendingDuesPayments(3);
    const query = vi.spyOn(gateway(), 'query');
    query.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50)); // slow enough for the runs to overlap if nothing stopped them
      return { status: 'SUCCESS' };
    });

    const runs = await Promise.all(Array.from({ length: 5 }, () => runReconcile(0)));

    expect(runs.filter(r => r !== null)).toEqual([{ checked: 3, settled: 3 }]);
    expect(query).toHaveBeenCalledTimes(3);
    for (const m of members) {
      expect(await prisma.duesPayment.count({ where: { memberId: m.id } })).toBe(1);
      expect(await prisma.payment.count({ where: { memberId: m.id, status: 'SUCCESS' } })).toBe(1);
    }
    expect(await prisma.jobLease.count()).toBe(0); // released straight away with no cool-down
  });

  it('with a cool-down, the cluster reconciles once per interval, not once per instance', async () => {
    await pendingDuesPayments(1);
    const query = vi.spyOn(gateway(), 'query').mockResolvedValue({ status: 'PENDING' });
    expect(await runReconcile(60_000)).toEqual({ checked: 1, settled: 0 });
    expect(await runReconcile(60_000)).toBeNull(); // another instance, a tick later
    expect(query).toHaveBeenCalledTimes(1);
    // When the interval is up, the next instance to try runs it.
    await prisma.jobLease.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await runReconcile(60_000)).toEqual({ checked: 1, settled: 0 });
  });

  it('recovers from a holder that crashed mid-run once its lease runs out', async () => {
    await pendingDuesPayments(1);
    await prisma.jobLease.create({ data: { name: 'payments.reconcile', owner: 'crashed-instance', expiresAt: new Date(Date.now() + 60_000) } });
    expect(await runReconcile(0)).toBeNull();
    await prisma.jobLease.update({ where: { name: 'payments.reconcile' }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await runReconcile(0)).toEqual({ checked: 1, settled: 1 });
  });

  it('stops at the next payment when its lease was lost, and survives a gateway that hangs or fails', async () => {
    await pendingDuesPayments(3);
    const query = vi.spyOn(gateway(), 'query').mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue({ status: 'SUCCESS' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let checks = 0;
    const r = await reconcilePending(SYSTEM, async () => ++checks <= 2); // lease lost before the third payment
    expect(r).toEqual({ checked: 2, settled: 1 }); // the first query failed and is retried next run; it is not an error
    expect(query).toHaveBeenCalledTimes(2);

    // A gateway that never answers costs PAYMENT_INITIATE_TIMEOUT_SECONDS (1 s in tests) per payment, not forever.
    query.mockReset().mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    expect(await reconcilePending()).toEqual({ checked: 2, settled: 0 });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('applies concurrent outcomes for one payment exactly once (webhook and reconciliation together)', async () => {
    const [m] = await pendingDuesPayments(1);
    const p = await prisma.payment.findFirstOrThrow({ where: { memberId: m.id } });
    const before = await prisma.member.findUniqueOrThrow({ where: { id: m.id } });
    await Promise.all([settle(p.id, { status: 'SUCCESS' }, SYSTEM), settle(p.id, { status: 'SUCCESS' }, SYSTEM), settle(p.id, { status: 'FAILED' }, SYSTEM)]);
    const after = await prisma.member.findUniqueOrThrow({ where: { id: m.id } });
    const status = (await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status;
    const dues = await prisma.duesPayment.count({ where: { memberId: m.id } });
    // Whichever outcome won the row lock is the only one applied.
    if (status === 'SUCCESS') {
      expect(dues).toBe(1);
      expect(after.validUntil.getTime()).toBe(addYears(before.validUntil, 1).getTime());
    } else {
      expect(dues).toBe(0);
      expect(after.validUntil).toEqual(before.validUntil);
    }
  });
});

/* ================= D6: reminders that survive missed nights ================= */

const emailsTo = (to: string, subject?: string) => prisma.notification.count({ where: { to, channel: 'EMAIL', ...(subject && { subject: { contains: subject } }) } });

describe('dues and MoF reminders', () => {
  beforeEach(resetDb);

  it('picks the most urgent reminder a date has reached', () => {
    expect(dueReminder(61, [60, 30, 7])).toBeNull();
    expect(dueReminder(60, [60, 30, 7])).toBe(60);
    expect(dueReminder(45, [60, 30, 7])).toBe(60);
    expect(dueReminder(30, [60, 30, 7])).toBe(30);
    expect(dueReminder(5, [60, 30, 7])).toBe(7);
    expect(dueReminder(0, [60, 30, 7])).toBe(7);
    expect(dueReminder(-1, [60, 30, 7])).toBeNull();
  });

  it('sends a reminder on its day, once, however often the job runs', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 60) });
    expect(await sendReminders()).toEqual({ sent: 1, failed: 0 });
    expect(await sendReminders()).toEqual({ sent: 0, failed: 0 });
    expect(await emailsTo(m.email, 'expires in 60 days')).toBe(1);
    expect(await prisma.reminderLog.findMany({ where: { memberId: m.id }, select: { key: true } })).toEqual([{ key: `dues:60:${isoDate(m.validUntil)}` }]);
  });

  it('catches up the next night after a missed run', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 29) }); // the 30-day reminder was due yesterday
    await sendReminders();
    expect(await emailsTo(m.email, 'expires in 29 days')).toBe(1);
    expect(await prisma.reminderLog.count({ where: { memberId: m.id, key: `dues:30:${isoDate(m.validUntil)}` } })).toBe(1);
  });

  it('after several missed nights sends only the most urgent reminder, then each later one on time', async () => {
    const t0 = today();
    const m = await makeMember({ validUntil: addDays(t0, 65) });
    expect((await sendReminders(t0)).sent).toBe(0); // nothing due yet
    // The job does not run for a week: the 60-day reminder is caught up, late but not lost.
    expect((await sendReminders(addDays(t0, 8))).sent).toBe(1);
    expect(await emailsTo(m.email, 'expires in 57 days')).toBe(1);
    // Then a month and a half of outages: both the 30- and 7-day reminders were missed; only the 7-day one goes out.
    expect((await sendReminders(addDays(t0, 61))).sent).toBe(1);
    expect(await emailsTo(m.email, 'expires in 4 days')).toBe(1);
    expect((await sendReminders(addDays(t0, 62))).sent).toBe(0);
    expect((await sendReminders(addDays(t0, 65))).sent).toBe(0); // the last day: still nothing repeated
    expect(await emailsTo(m.email)).toBe(2);
  });

  it('never sends twice when two runs overlap (two instances, or a retried job)', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 7) });
    const runs = await Promise.all([sendReminders(), sendReminders(), sendReminders()]);
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(await emailsTo(m.email, 'expires in 7 days')).toBe(1);
  });

  it('keeps going when one reminder fails, and sends the failed one on the next run', async () => {
    const a = await makeMember({ validUntil: addDays(today(), 30) });
    const b = await makeMember({ validUntil: addDays(today(), 30) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const tx = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(() => Promise.reject(new Error('deadlock detected'))).mockImplementation(tx as never);
    expect(await sendReminders()).toEqual({ sent: 1, failed: 1 });
    // The failed reminder left nothing behind (no log row without its message), so the next run sends it.
    expect(await sendReminders()).toEqual({ sent: 1, failed: 0 });
    expect(await emailsTo(a.email, 'expires in 30 days')).toBe(1);
    expect(await emailsTo(b.email, 'expires in 30 days')).toBe(1);
  });

  it('sends nothing for dues already paid, or to lapsed and suspended members', async () => {
    const paid = await makeMember({ validUntil: addDays(today(), 30) });
    const pay = await (await as(paid.email)).post('/portal/dues/payments', { method: 'MTN_MOMO', msisdn: '0977123456' });
    expect(pay.statusCode, pay.body).toBe(201);
    await reconcilePending(); // the sandbox settles: validUntil moves a year on
    const lapsed = await makeMember({ validUntil: addDays(today(), 30), status: 'LAPSED' });
    const suspended = await makeMember({ validUntil: addDays(today(), 30), status: 'SUSPENDED' });
    const ended = await makeMember({ validUntil: addDays(today(), -1) }); // the lapse rule's business, not a reminder's

    await sendReminders();
    for (const m of [paid, lapsed, suspended, ended]) expect(await emailsTo(m.email, 'MLAZ dues')).toBe(0);
  });

  it('catches up a missed MoF reminder, but not while a renewal is waiting for review', async () => {
    const late = await makeMember({ mofExpiry: addDays(today(), 6) });
    const renewing = await makeMember({ mofExpiry: addDays(today(), 6) });
    await prisma.mofRenewal.create({ data: { memberId: renewing.id, mofRef: 'MoF/ML/2027/0042' } });
    await sendReminders();
    expect(await emailsTo(late.email, 'MoF authorization expires in 6 days')).toBe(1);
    expect(await emailsTo(renewing.email, 'MoF authorization')).toBe(0);
    expect(await prisma.reminderLog.count({ where: { memberId: late.id, key: `mof:7:${isoDate(late.mofExpiry!)}` } })).toBe(1);
  });

  it('counts days in Lusaka time, so the reminder day turns over at midnight in Zambia, not UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-01T21:59:59Z')); // 23:59:59 in Lusaka (UTC+2)
    expect(todayIso()).toBe('2027-03-01');
    vi.setSystemTime(new Date('2027-03-01T22:00:00Z')); // midnight in Lusaka, still 1 March in UTC
    expect(todayIso()).toBe('2027-03-02');
    vi.useRealTimers();

    // A period ending 2027-03-31 is 30 days away on Lusaka's 1 March and 29 days on its 2 March.
    const m = await makeMember({ validUntil: new Date('2027-03-31T00:00:00Z') });
    await sendReminders(new Date('2027-03-02T00:00:00Z'));
    expect(await emailsTo(m.email, 'expires in 29 days')).toBe(1);
    expect(await prisma.reminderLog.count({ where: { memberId: m.id, key: 'dues:30:2027-03-31' } })).toBe(1);
  });

  it('runs the reminders even when an earlier nightly rule fails, and reports what failed', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 30) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.member, 'findMany').mockRejectedValueOnce(new Error('connection reset')); // the lapse rule's query
    const r = await runNightly();
    expect(r.failed).toEqual(['lapse']);
    expect(r.reminders).toEqual({ sent: 1, failed: 0 });
    expect(await emailsTo(m.email, 'expires in 30 days')).toBe(1);
  });

  it('does not repeat a reminder sent under the previous exact-date rule', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 25) });
    await prisma.reminderLog.create({ data: { memberId: m.id, key: `dues:30:${isoDate(m.validUntil)}` } }); // sent 5 days ago
    expect((await sendReminders()).sent).toBe(0);
  });
});

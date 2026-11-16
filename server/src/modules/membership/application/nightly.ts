import { SYSTEM } from '../../../shared/actor.js';
import { addDays, daysBetween, fmtDate, isoDate, today } from '../../../shared/dates.js';
import { type Tx, prisma } from '../../../shared/db.js';
import { log } from '../../../shared/log.js';
import { activity, audit } from '../../audit/index.js';
import { tierDues } from '../../administration/index.js';
import { notify } from '../../communications/index.js';
import { DUES_REMINDER_DAYS, MOF_REMINDER_DAYS, dueReminder } from '../domain/standing.js';
import { suspend } from './accreditation.js';
import { membershipMessages } from './messages.js';
import { contactOf } from './queries.js';

// The nightly membership rules, run by the job scheduler. Each catches up on what a missed night left undone.

export async function lapseEndedPeriods() {
  const due = await prisma.member.findMany({ where: { status: 'ACTIVE', validUntil: { lt: today() } } });
  for (const m of due) {
    await prisma.$transaction(async tx => {
      await tx.member.update({ where: { id: m.id }, data: { status: 'LAPSED', accreditation: 'EXPIRED' } });
      await activity(tx, m.id, 'lapsed', 'Membership lapsed', `Dues period ended ${fmtDate(m.validUntil)}`);
      await audit(tx, SYSTEM, m.number, 'Membership lapsed', `Dues period ended ${fmtDate(m.validUntil)}`);
      await notify(tx, contactOf(m), membershipMessages.lapsed(m));
    });
  }
  return due.length;
}

export async function expireMofAuthorizations() {
  const due = await prisma.member.findMany({ where: { mofStatus: 'VALID', mofExpiry: { lt: today() } } });
  for (const m of due) {
    await prisma.$transaction(async tx => {
      await tx.member.update({ where: { id: m.id }, data: { mofStatus: 'EXPIRED' } });
      if (m.status === 'SUSPENDED') await audit(tx, SYSTEM, m.number, 'MoF authorization expired', m.mofRef);
      else await suspend(tx, m, SYSTEM, `Ministry of Finance authorization ${m.mofRef} expired on ${fmtDate(m.mofExpiry!)}`, 'MOF_EXPIRED');
    });
  }
  return due.length;
}

/**
 * Sends dues and MoF expiry reminders. Each reminder is due from its offset until the date itself, not only on the
 * exact day, so a night the job did not run (or failed) is caught up by the next run. Only the most urgent due
 * reminder goes out: after several missed nights the member gets "expires in 5 days", not three messages at once.
 *
 * ReminderLog (unique per member and key, written in the same transaction as the queued message) sends each
 * reminder once however often this runs, including on two instances at once. The keys are those the exact-date
 * version used, so nothing already sent is repeated. Each reminder is its own transaction: one that fails is counted
 * and retried the next night, and the others still go out. Dates are Lusaka calendar days (see shared/dates).
 */
export async function sendReminders(t = today()) {
  let sent = 0, failed = 0;
  const once = async (memberId: string, key: string, send: (tx: Tx) => Promise<unknown>) => {
    try {
      const queued = await prisma.$transaction(async tx => {
        const r = await tx.reminderLog.createMany({ data: [{ memberId, key }], skipDuplicates: true });
        if (r.count) await send(tx);
        return r.count > 0;
      });
      if (queued) sent++;
    } catch (err) {
      failed++;
      log().error({ event: 'job.reminder_failed', reminder: key, memberId, err }, `Reminder ${key} for member ${memberId} failed`);
    }
  };

  // Dues: active members whose paid period ends within the widest window, and who have not already paid ahead.
  const duesDue = await prisma.member.findMany({ where: { status: 'ACTIVE', validUntil: { gte: t, lte: addDays(t, Math.max(...DUES_REMINDER_DAYS)) } } });
  const paidAhead = await prisma.duesPayment.findMany({ where: { memberId: { in: duesDue.map(m => m.id) }, periodStart: { gt: t } }, select: { memberId: true, periodStart: true } });
  const amounts = new Map<string, number>();
  for (const m of duesDue) {
    const daysLeft = daysBetween(t, m.validUntil);
    const offset = dueReminder(daysLeft, DUES_REMINDER_DAYS);
    if (offset === null || paidAhead.some(d => d.memberId === m.id && d.periodStart > m.validUntil)) continue;
    if (!amounts.has(m.tierName)) amounts.set(m.tierName, await tierDues(prisma, m.tierName));
    const amount = amounts.get(m.tierName)!;
    await once(m.id, `dues:${offset}:${isoDate(m.validUntil)}`, async tx => {
      await notify(tx, contactOf(m), membershipMessages.duesReminder(m, daysLeft, amount));
      await activity(tx, m.id, 'reminder_sent', 'Dues reminder sent', `${daysLeft} days before ${fmtDate(m.validUntil)}`);
    });
  }

  // MoF: valid authorizations expiring within the widest window, unless a renewal is already waiting for review.
  const mofDue = await prisma.member.findMany({ where: { mofStatus: 'VALID', mofExpiry: { gte: t, lte: addDays(t, Math.max(...MOF_REMINDER_DAYS)) } } });
  const renewing = new Set((await prisma.mofRenewal.findMany({ where: { memberId: { in: mofDue.map(m => m.id) }, status: 'PENDING' }, select: { memberId: true } })).map(r => r.memberId));
  for (const m of mofDue) {
    const daysLeft = daysBetween(t, m.mofExpiry!);
    const offset = dueReminder(daysLeft, MOF_REMINDER_DAYS);
    if (offset === null || renewing.has(m.id)) continue;
    await once(m.id, `mof:${offset}:${isoDate(m.mofExpiry!)}`, tx => notify(tx, contactOf(m), membershipMessages.mofExpiring({ ...m, mofExpiry: m.mofExpiry! }, daysLeft)));
  }
  return { sent, failed };
}

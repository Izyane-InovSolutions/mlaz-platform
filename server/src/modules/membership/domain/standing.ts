import { addDays, addYears, today } from '../../../shared/dates.js';

// Membership rules
// - A member is in good standing (listed publicly, passes verification) when ACTIVE, accreditation ISSUED, MoF
//   authorization VALID and the paid period (validUntil, inclusive) has not ended.
// - Paying dues extends validUntil by a year from the end of the current period (or from today if it already ended).
// - Nightly: an ended period makes an ACTIVE member LAPSED; an expired MoF authorization suspends the member until a
//   renewal is verified. Suspensions imposed by staff are only lifted by staff.

export interface Standing {
  status: 'ACTIVE' | 'LAPSED' | 'SUSPENDED';
  accreditation: 'ISSUED' | 'EXPIRED' | 'REVOKED';
  mofStatus: 'VALID' | 'EXPIRED';
  validUntil: Date;
}

export const inGoodStanding = (m: Standing) =>
  m.status === 'ACTIVE' && m.accreditation === 'ISSUED' && m.mofStatus === 'VALID' && m.validUntil >= today();

/** The dues period a payment made today buys: the year after the current one, or a year from today if it has ended. */
export function nextDuesPeriod(validUntil: Date, t = today()) {
  const periodStart = validUntil >= t ? addDays(validUntil, 1) : t;
  return { periodStart, periodEnd: addDays(addYears(periodStart, 1), -1) };
}

/** A new member's first period: today until the day before the same date next year. */
export const firstDuesPeriod = (t = today()) => ({ periodStart: t, periodEnd: addDays(addYears(t, 1), -1) });

/** Certificate serials: MLAZ/ACC/<member number digits>/<yy>, with -2, -3... for further certificates in the same year. */
export const certificateSerialBase = (memberNumber: string, t = today()) =>
  `MLAZ/ACC/${memberNumber.replace(/^MLA-/, '')}/${String(t.getUTCFullYear()).slice(2)}`;
export const certificateSerial = (base: string, issuedThisYear: number) => (issuedThisYear ? `${base}-${issuedThisYear + 1}` : base);

// Days before the end of a dues period, and before a MoF authorization expires, at which a reminder is due.
export const DUES_REMINDER_DAYS = [60, 30, 7];
export const MOF_REMINDER_DAYS = [30, 7];

/** The reminder due for a date `daysLeft` away: the nearest offset already reached, or null (none yet, or past). */
export function dueReminder(daysLeft: number, offsets: number[]) {
  if (daysLeft < 0) return null;
  const reached = offsets.filter(d => daysLeft <= d);
  return reached.length ? Math.min(...reached) : null;
}

import type { Application, Member, Payment, PaymentLine, SuspensionKind } from '../generated/prisma/client.js';
import { type Actor, SYSTEM, activity, audit } from '../lib/audit.js';
import { addDays, addYears, daysBetween, fmtDate, isoDate, today } from '../lib/dates.js';
import { type Db, type Tx, prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { nextRef } from '../lib/ids.js';
import { K, num } from '../lib/money.js';
import type { StoredFile } from '../lib/uploads.js';
import { inviteUser } from './accounts.js';
import { T, notify } from './notifications.js';
import { getSetting, tierDues } from './settings.js';

// Membership rules
// - A member is in good standing (listed publicly, passes verification) when ACTIVE, accreditation ISSUED, MoF
//   authorization VALID and the paid period (validUntil, inclusive) has not ended.
// - Paying dues extends validUntil by a year from the end of the current period (or from today if it already ended).
// - Nightly: an ended period makes an ACTIVE member LAPSED; an expired MoF authorization suspends the member until a
//   renewal is verified. Suspensions imposed by staff are only lifted by staff.

type Standing = Pick<Member, 'status' | 'accreditation' | 'validUntil' | 'mofStatus'>;
export const inGoodStanding = (m: Standing) =>
  m.status === 'ACTIVE' && m.accreditation === 'ISSUED' && m.mofStatus === 'VALID' && m.validUntil >= today();

/** The next dues period for a member, and whether it is payable yet. */
export async function duesInfo(db: Db, m: Pick<Member, 'validUntil' | 'tierName'>) {
  const t = today();
  const windowDays = await getSetting(db, 'renewalWindowDays');
  const periodStart = m.validUntil >= t ? addDays(m.validUntil, 1) : t;
  const periodEnd = addDays(addYears(periodStart, 1), -1);
  const daysLeft = daysBetween(t, m.validUntil);
  return {
    amount: await tierDues(db, m.tierName),
    payable: daysLeft <= windowDays,
    overdue: daysLeft < 0,
    daysLeft,
    periodStart,
    periodEnd,
    opensOn: addDays(m.validUntil, -windowDays),
  };
}

export async function issueCertificate(db: Db, m: Pick<Member, 'id' | 'number' | 'validUntil'>) {
  await db.certificate.updateMany({ where: { memberId: m.id, status: 'VALID' }, data: { status: 'SUPERSEDED' } });
  const base = `MLAZ/ACC/${m.number.replace(/^MLA-/, '')}/${String(today().getUTCFullYear()).slice(2)}`;
  const issuedThisYear = await db.certificate.count({ where: { serial: { startsWith: base } } });
  return db.certificate.create({ data: { serial: issuedThisYear ? `${base}-${issuedThisYear + 1}` : base, memberId: m.id, validUntil: m.validUntil } });
}

const contact = (m: Pick<Member, 'contactEmail' | 'contactPhone'>) => ({ email: m.contactEmail, phone: m.contactPhone });

/**
 * Turns a paid application into a member: member record, first dues period, certificate and a portal account.
 * Called when the application's payment succeeds.
 */
export async function accreditApplication(tx: Tx, app: Application, payment: Payment & { lines: PaymentLine[] }) {
  const t = today();
  const validUntil = addDays(addYears(t, 1), -1);
  const member = await tx.member.create({
    data: {
      number: await nextRef(tx, 'member'),
      name: app.businessName, town: app.town, province: app.province, address: app.address, tpin: app.tpin, pacra: app.pacra,
      tierName: app.tierName, mofRef: app.mofRef ?? '', mofExpiry: app.mofExpiry, validUntil,
      contactName: app.contactName, contactPhone: app.phone, contactEmail: app.email, joinedAt: t, applicationId: app.id,
    },
  });
  await tx.application.update({ where: { id: app.id }, data: { stage: 'ACCREDITED' } });
  await tx.payment.update({ where: { id: payment.id }, data: { memberId: member.id } });
  await tx.document.updateMany({ where: { applicationId: app.id }, data: { memberId: member.id } });
  const dues = payment.lines.find(l => l.type === 'DUES');
  await tx.duesPayment.create({ data: { memberId: member.id, paymentId: payment.id, periodStart: t, periodEnd: validUntil, amount: dues?.amount ?? 0 } });
  const cert = await issueCertificate(tx, member);

  await activity(tx, member.id, 'dues_paid', 'Joining fee and first year’s dues paid', `${K(payment.amount)} · ${payment.ref}`);
  await activity(tx, member.id, 'accreditation_issued', 'Accreditation issued', `Certificate ${cert.serial}, valid until ${fmtDate(validUntil)}`);
  await audit(tx, SYSTEM, app.ref, 'Accreditation issued', `Member ${member.number} · certificate ${cert.serial} · issued automatically on payment`);
  await audit(tx, SYSTEM, member.number, 'Member created', `From application ${app.ref}`);

  let setPasswordUrl: string | null = null;
  if (await tx.user.findUnique({ where: { email: app.email.toLowerCase() } })) {
    await audit(tx, SYSTEM, member.number, 'Portal account not created', `${app.email} already has an account; invite another address from the console`);
  } else {
    ({ url: setPasswordUrl } = await inviteUser(tx, { email: app.email, name: app.contactName, role: 'MEMBER', memberId: member.id }));
  }
  await notify(tx, contact(member), T.accredited(member, setPasswordUrl));
  return member;
}

/** Records a paid dues period: extends validity, restores a lapsed member and issues a fresh certificate. */
export async function applyDues(tx: Tx, payment: Payment & { lines: PaymentLine[] }, m: Member) {
  const t = today();
  const periodStart = m.validUntil >= t ? addDays(m.validUntil, 1) : t;
  const periodEnd = addDays(addYears(periodStart, 1), -1);
  await tx.duesPayment.create({ data: { memberId: m.id, paymentId: payment.id, periodStart, periodEnd, amount: payment.amount } });
  const restore = m.status === 'LAPSED' && m.mofStatus === 'VALID';
  const updated = await tx.member.update({
    where: { id: m.id },
    data: { validUntil: periodEnd, ...(restore && { status: 'ACTIVE', accreditation: 'ISSUED' }) },
  });
  const detail = `${K(payment.amount)} · ${fmtDate(periodStart)} to ${fmtDate(periodEnd)} · ${payment.ref}`;
  await activity(tx, m.id, 'dues_paid', 'Annual dues paid', detail);
  await audit(tx, SYSTEM, m.number, restore ? 'Dues paid, membership restored' : 'Dues paid', detail);
  if (inGoodStanding(updated)) await issueCertificate(tx, updated);
  return updated;
}

export async function suspend(tx: Tx, m: Member, actor: Actor, reason: string, kind: SuspensionKind) {
  await tx.member.update({ where: { id: m.id }, data: { status: 'SUSPENDED', accreditation: 'REVOKED', suspension: kind, suspensionReason: reason } });
  await tx.certificate.updateMany({ where: { memberId: m.id, status: 'VALID' }, data: { status: 'REVOKED' } });
  await activity(tx, m.id, 'suspended', 'Membership suspended', reason);
  await audit(tx, actor, m.number, 'Membership suspended', reason);
  await notify(tx, contact(m), kind === 'MOF_EXPIRED' ? T.mofExpired(m) : T.suspended(m, reason));
}

/** Staff action. Only possible when the MoF authorization is valid and the dues period has not ended. */
export async function reinstate(actor: Actor, number: string) {
  return prisma.$transaction(async tx => {
    const m = await memberByNumber(tx, number);
    if (m.status === 'ACTIVE') throw conflict(`${m.name} is already active.`);
    if (m.mofStatus !== 'VALID' || (m.mofExpiry && m.mofExpiry < today())) throw conflict('The MoF authorization must be valid before reinstating. Verify a renewal first.', 'MOF_INVALID');
    if (m.validUntil < today()) throw conflict('The membership period has ended. Record a dues payment to restore the member.', 'DUES_OUTSTANDING');
    const updated = await tx.member.update({ where: { id: m.id }, data: { status: 'ACTIVE', accreditation: 'ISSUED', suspension: null, suspensionReason: null } });
    await issueCertificate(tx, updated);
    await activity(tx, m.id, 'reinstated', 'Membership reinstated', fmtDate(new Date()));
    await audit(tx, actor, m.number, 'Membership reinstated');
    await notify(tx, contact(m), T.reinstated(m));
    return updated;
  });
}

export async function memberByNumber(db: Db, number: string) {
  const m = await db.member.findUnique({ where: { number: number.toUpperCase() } });
  if (!m) throw notFound(`Member ${number}`);
  return m;
}

/* ================= MoF RENEWALS ================= */

export async function submitRenewal(actor: Actor, memberId: string, mofRef: string, file: StoredFile) {
  return prisma.$transaction(async tx => {
    const m = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
    if (await tx.mofRenewal.findFirst({ where: { memberId, status: 'PENDING' } })) throw conflict('A renewal is already awaiting verification.', 'RENEWAL_PENDING');
    const doc = await tx.document.create({ data: { ...file, memberId, uploadedBy: actor.label } });
    const renewal = await tx.mofRenewal.create({ data: { memberId, mofRef, documentId: doc.id } });
    await activity(tx, memberId, 'mof_renewal', 'MoF renewal uploaded', `${mofRef} · ${doc.filename}`);
    await audit(tx, actor, m.number, 'MoF renewal uploaded', mofRef);
    return renewal;
  });
}

export async function verifyRenewal(actor: Actor, renewalId: string, mofExpiry: Date) {
  if (mofExpiry <= today()) throw badRequest('The authorization expiry date must be in the future.');
  return prisma.$transaction(async tx => {
    const r = await tx.mofRenewal.findUnique({ where: { id: renewalId }, include: { member: true } });
    if (!r) throw notFound('Renewal');
    if (r.status !== 'PENDING') throw conflict('This renewal has already been reviewed.');
    const m = r.member;
    await tx.mofRenewal.update({ where: { id: r.id }, data: { status: 'VERIFIED', reviewedBy: actor.label, reviewedAt: new Date() } });
    const lift = m.status === 'SUSPENDED' && m.suspension === 'MOF_EXPIRED';
    const periodOpen = m.validUntil >= today();
    const updated = await tx.member.update({
      where: { id: m.id },
      data: {
        mofStatus: 'VALID', mofRef: r.mofRef, mofExpiry,
        ...(lift && { suspension: null, suspensionReason: null, ...(periodOpen ? { status: 'ACTIVE', accreditation: 'ISSUED' } : { status: 'LAPSED', accreditation: 'EXPIRED' }) }),
      },
    });
    if (lift && periodOpen) await issueCertificate(tx, updated);
    await activity(tx, m.id, 'mof_renewal', 'MoF renewal verified', `${r.mofRef} · valid until ${fmtDate(mofExpiry)}`);
    await audit(tx, actor, m.number, 'MoF renewal verified', `${r.mofRef} · valid until ${fmtDate(mofExpiry)}${lift ? (periodOpen ? ' · suspension lifted' : ' · suspension lifted, dues outstanding') : ''}`);
    await notify(tx, contact(m), T.renewalVerified(m, mofExpiry));
    return updated;
  });
}

export async function rejectRenewal(actor: Actor, renewalId: string, reason: string) {
  return prisma.$transaction(async tx => {
    const r = await tx.mofRenewal.findUnique({ where: { id: renewalId }, include: { member: true } });
    if (!r) throw notFound('Renewal');
    if (r.status !== 'PENDING') throw conflict('This renewal has already been reviewed.');
    await tx.mofRenewal.update({ where: { id: r.id }, data: { status: 'REJECTED', reviewedBy: actor.label, reviewedAt: new Date(), reviewNote: reason } });
    await activity(tx, r.memberId, 'mof_renewal', 'MoF renewal not accepted', reason);
    await audit(tx, actor, r.member.number, 'MoF renewal rejected', `${r.mofRef} · ${reason}`);
    await notify(tx, contact(r.member), T.renewalRejected(r.member, reason));
  });
}

/* ================= NIGHTLY RULES ================= */

export async function lapseEndedPeriods() {
  const due = await prisma.member.findMany({ where: { status: 'ACTIVE', validUntil: { lt: today() } } });
  for (const m of due) {
    await prisma.$transaction(async tx => {
      await tx.member.update({ where: { id: m.id }, data: { status: 'LAPSED', accreditation: 'EXPIRED' } });
      await activity(tx, m.id, 'lapsed', 'Membership lapsed', `Dues period ended ${fmtDate(m.validUntil)}`);
      await audit(tx, SYSTEM, m.number, 'Membership lapsed', `Dues period ended ${fmtDate(m.validUntil)}`);
      await notify(tx, contact(m), T.lapsed(m));
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

/** Sends dues and MoF expiry reminders at fixed offsets. ReminderLog makes each reminder go out once per period. */
export async function sendReminders() {
  const t = today();
  let sent = 0;
  const once = async (memberId: string, key: string, send: (tx: Tx) => Promise<unknown>) => {
    await prisma.$transaction(async tx => {
      const r = await tx.reminderLog.createMany({ data: [{ memberId, key }], skipDuplicates: true });
      if (r.count) { await send(tx); sent++; }
    });
  };
  for (const days of [60, 30, 7]) {
    const members = await prisma.member.findMany({ where: { status: 'ACTIVE', validUntil: addDays(t, days) } });
    for (const m of members) {
      if (await prisma.duesPayment.findFirst({ where: { memberId: m.id, periodStart: { gt: m.validUntil } } })) continue;
      const amount = await tierDues(prisma, m.tierName);
      await once(m.id, `dues:${days}:${isoDate(m.validUntil)}`, async tx => {
        await notify(tx, contact(m), T.duesReminder(m, days, amount));
        await activity(tx, m.id, 'reminder_sent', 'Dues reminder sent', `${days} days before ${fmtDate(m.validUntil)}`);
      });
    }
  }
  for (const days of [30, 7]) {
    const members = await prisma.member.findMany({ where: { mofStatus: 'VALID', mofExpiry: addDays(t, days) } });
    for (const m of members) {
      if (await prisma.mofRenewal.findFirst({ where: { memberId: m.id, status: 'PENDING' } })) continue;
      await once(m.id, `mof:${days}:${isoDate(m.mofExpiry!)}`, tx => notify(tx, contact(m), T.mofExpiring({ ...m, mofExpiry: m.mofExpiry! }, days)));
    }
  }
  return sent;
}

/* ================= VIEWS ================= */

// Sequential on purpose: `db` may be a transaction client, which must not run queries concurrently.
export async function memberSummary(db: Db, m: Member) {
  const dues = await duesInfo(db, m);
  const pendingRenewal = await db.mofRenewal.findFirst({ where: { memberId: m.id, status: 'PENDING' }, select: { id: true, mofRef: true, submittedAt: true } });
  const certificate = await db.certificate.findFirst({ where: { memberId: m.id }, orderBy: { issuedAt: 'desc' } });
  return {
    id: m.id, number: m.number, name: m.name, town: m.town, province: m.province, address: m.address, tpin: m.tpin, pacra: m.pacra,
    tier: m.tierName, status: m.status, accreditation: m.accreditation, suspension: m.suspension, suspensionReason: m.suspensionReason,
    mofStatus: m.mofStatus, mofRef: m.mofRef, mofExpiry: m.mofExpiry, validUntil: m.validUntil, joinedAt: m.joinedAt,
    contactName: m.contactName, contactPhone: m.contactPhone, contactEmail: m.contactEmail,
    goodStanding: inGoodStanding(m),
    dues: { ...dues, amount: num(dues.amount) },
    pendingRenewal,
    certificate: certificate && { serial: certificate.serial, status: certificate.status, issuedAt: certificate.issuedAt, validUntil: certificate.validUntil },
  };
}

import type { Application, Member, Payment, PaymentLine, SuspensionKind } from '../../../generated/prisma/client.js';
import { type Actor, SYSTEM } from '../../../shared/actor.js';
import { fmtDate, today } from '../../../shared/dates.js';
import { type Db, type Tx, prisma } from '../../../shared/db.js';
import { conflict } from '../../../shared/errors.js';
import { nextRef } from '../../../shared/ids.js';
import { K } from '../../../shared/money.js';
import { activity, audit } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { assignApplicationDocuments } from '../../documents/index.js';
import { emailTaken, inviteUser } from '../../identity/index.js';
import { linkToMember } from '../../payments/index.js';
import { certificateSerial, certificateSerialBase, firstDuesPeriod } from '../domain/standing.js';
import { membershipMessages } from './messages.js';
import { contactOf, memberByNumber } from './queries.js';

export async function issueCertificate(db: Db, m: Pick<Member, 'id' | 'number' | 'validUntil'>) {
  await db.certificate.updateMany({ where: { memberId: m.id, status: 'VALID' }, data: { status: 'SUPERSEDED' } });
  const base = certificateSerialBase(m.number);
  const issuedThisYear = await db.certificate.count({ where: { serial: { startsWith: base } } });
  return db.certificate.create({ data: { serial: certificateSerial(base, issuedThisYear), memberId: m.id, validUntil: m.validUntil } });
}

/**
 * Turns a paid application into a member: member record, first dues period, certificate and a portal account. Called
 * from the applications module's settlement handler, inside the transaction that settles the application's payment.
 */
export async function accreditApplication(tx: Tx, app: Application, payment: Payment & { lines: PaymentLine[] }) {
  const { periodStart: t, periodEnd: validUntil } = firstDuesPeriod();
  const member = await tx.member.create({
    data: {
      number: await nextRef(tx, 'member'),
      name: app.businessName, town: app.town, province: app.province, address: app.address, tpin: app.tpin, pacra: app.pacra,
      tierName: app.tierName, mofRef: app.mofRef ?? '', mofExpiry: app.mofExpiry, validUntil,
      contactName: app.contactName, contactPhone: app.phone, contactEmail: app.email, joinedAt: t, applicationId: app.id,
    },
  });
  await linkToMember(tx, payment.id, member.id);
  await assignApplicationDocuments(tx, app.id, member.id);
  const dues = payment.lines.find(l => l.type === 'DUES');
  await tx.duesPayment.create({ data: { memberId: member.id, paymentId: payment.id, periodStart: t, periodEnd: validUntil, amount: dues?.amount ?? 0 } });
  const cert = await issueCertificate(tx, member);

  await activity(tx, member.id, 'dues_paid', 'Joining fee and first year’s dues paid', `${K(payment.amount)} · ${payment.ref}`);
  await activity(tx, member.id, 'accreditation_issued', 'Accreditation issued', `Certificate ${cert.serial}, valid until ${fmtDate(validUntil)}`);
  await audit(tx, SYSTEM, app.ref, 'Accreditation issued', `Member ${member.number} · certificate ${cert.serial} · issued automatically on payment`);
  await audit(tx, SYSTEM, member.number, 'Member created', `From application ${app.ref}`);

  let setPasswordUrl: string | null = null;
  if (await emailTaken(tx, app.email)) {
    await audit(tx, SYSTEM, member.number, 'Portal account not created', `${app.email} already has an account; invite another address from the console`);
  } else {
    ({ url: setPasswordUrl } = await inviteUser(tx, { email: app.email, name: app.contactName, role: 'MEMBER', memberId: member.id }));
  }
  await notify(tx, contactOf(member), membershipMessages.accredited(member, setPasswordUrl));
  return member;
}

export async function suspend(tx: Tx, m: Member, actor: Actor, reason: string, kind: SuspensionKind) {
  await tx.member.update({ where: { id: m.id }, data: { status: 'SUSPENDED', accreditation: 'REVOKED', suspension: kind, suspensionReason: reason } });
  await tx.certificate.updateMany({ where: { memberId: m.id, status: 'VALID' }, data: { status: 'REVOKED' } });
  await activity(tx, m.id, 'suspended', 'Membership suspended', reason);
  await audit(tx, actor, m.number, 'Membership suspended', reason);
  await notify(tx, contactOf(m), kind === 'MOF_EXPIRED' ? membershipMessages.mofExpired(m) : membershipMessages.suspended(m, reason));
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
    await notify(tx, contactOf(m), membershipMessages.reinstated(m));
    return updated;
  });
}

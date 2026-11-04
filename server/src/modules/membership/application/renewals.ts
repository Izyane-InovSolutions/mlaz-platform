import type { Actor } from '../../../shared/actor.js';
import { fmtDate, today } from '../../../shared/dates.js';
import { prisma } from '../../../shared/db.js';
import { badRequest, conflict, notFound } from '../../../shared/errors.js';
import { activity, audit } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { type StoredFile, recordDocument } from '../../documents/index.js';
import { issueCertificate } from './accreditation.js';
import { membershipMessages } from './messages.js';
import { contactOf } from './queries.js';

// MoF renewals: a member uploads a renewed Ministry of Finance authorization; the Secretariat verifies or rejects it.

export async function submitRenewal(actor: Actor, memberId: string, mofRef: string, file: StoredFile) {
  return prisma.$transaction(async tx => {
    const m = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
    if (await tx.mofRenewal.findFirst({ where: { memberId, status: 'PENDING' } })) throw conflict('A renewal is already awaiting verification.', 'RENEWAL_PENDING');
    const doc = await recordDocument(tx, file, { memberId }, actor.label);
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
    await notify(tx, contactOf(m), membershipMessages.renewalVerified(m, mofExpiry));
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
    await notify(tx, contactOf(r.member), membershipMessages.renewalRejected(r.member, reason));
  });
}

/** The Secretariat's renewal queue, oldest first. */
export const listRenewals = (status: 'PENDING' | 'VERIFIED' | 'REJECTED') => prisma.mofRenewal.findMany({
  where: { status }, orderBy: { submittedAt: 'asc' },
  include: { member: { select: { number: true, name: true, mofRef: true, mofExpiry: true, status: true } }, document: { select: { id: true, filename: true, mimeType: true } } },
});

export const myRenewals = (memberId: string) => prisma.mofRenewal.findMany({ where: { memberId }, orderBy: { submittedAt: 'desc' } });

export const pendingRenewals = () => prisma.mofRenewal.findMany({ where: { status: 'PENDING' }, include: { member: { select: { number: true, name: true } } } });

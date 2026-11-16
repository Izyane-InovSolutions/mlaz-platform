import { z } from 'zod';
import type { Application, Prisma as P } from '../../../generated/prisma/client.js';
import { type Actor, SYSTEM } from '../../../shared/actor.js';
import { dateOnly, today } from '../../../shared/dates.js';
import { type Db, prisma } from '../../../shared/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../../shared/errors.js';
import { K, num } from '../../../shared/money.js';
import { s } from '../../../shared/validation.js';
import { audit, trailFor } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { currentDocumentKinds, supersedeMofDocuments } from '../../documents/index.js';
import type { AuthUser } from '../../identity/index.js';
import { accreditApplication, memberForApplication, possibleDuplicateMembers } from '../../membership/index.js';
import { type OfflinePayment, type SettlementHandler, guardPending, lockPayments, paymentView, paymentsFor, recordOffline, viewsOf } from '../../payments/index.js';
import {
  type ApplicationStage, MIN_JUSTIFICATION, OPEN_STAGES, checkFlags, displayStage, isOpen, isOwnRecommendation, matchingFields, requiredDocuments, tpinLooksValid,
} from '../domain/journey.js';
import { applicationFees, applicationLines, assertStage } from './applicant.js';
import { applicationMessages } from './messages.js';
import { trackingUrl } from './tracking.js';

// The Secretariat's side: the review queue, automated checks and the maker/checker decision.

const appByRef = async (db: Db, ref: string) => {
  const a = await db.application.findUnique({ where: { ref: ref.trim().toUpperCase() } });
  if (!a) throw notFound(`Application ${ref}`);
  return a;
};

export async function list(q: { stage?: string; q?: string; page: number; pageSize: number }) {
  const where: P.ApplicationWhereInput = {};
  if (q.stage === 'OPEN') where.stage = { in: OPEN_STAGES };
  else if (q.stage === 'AWAITING_APPROVAL') Object.assign(where, { stage: 'MOF_REVIEW', recommendedById: { not: null } });
  else if (q.stage === 'MOF_REVIEW') Object.assign(where, { stage: 'MOF_REVIEW', recommendedById: null });
  else if (q.stage) where.stage = q.stage as ApplicationStage;
  if (q.q) where.OR = [{ businessName: { contains: q.q, mode: 'insensitive' } }, { ref: { contains: q.q, mode: 'insensitive' } }, { town: { contains: q.q, mode: 'insensitive' } }];
  const [rows, total] = await Promise.all([
    prisma.application.findMany({ where, orderBy: { submittedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { recommendedBy: { select: { name: true } } } }),
    prisma.application.count({ where }),
  ]);
  return {
    items: rows.map(a => ({
      ref: a.ref, businessName: a.businessName, town: a.town, province: a.province, tier: a.tierName, stage: a.stage, displayStage: displayStage(a),
      mofRef: a.mofRef, submittedAt: a.submittedAt, recommendedBy: a.recommendedBy?.name ?? null,
    })),
    total, page: q.page, pageSize: q.pageSize,
  };
}

/** Automated checks shown to the reviewing officer: TPIN format, possible duplicates and missing documents. */
export async function checks(db: Db, a: Application) {
  const self = { tpin: a.tpin, pacra: a.pacra, name: a.businessName, email: a.email, phone: a.phone };
  // Sequential on purpose: `db` may be a transaction client, which must not run queries concurrently.
  const members = await possibleDuplicateMembers(db, a);
  const apps = await db.application.findMany({ where: { id: { not: a.id }, stage: { in: OPEN_STAGES }, OR: [{ tpin: a.tpin }, { pacra: a.pacra }, { email: { equals: a.email, mode: 'insensitive' } }, { businessName: { equals: a.businessName, mode: 'insensitive' } }] } });
  const kinds = await currentDocumentKinds(db, a.id);
  const duplicates = [
    ...members.map(m => ({ type: 'member' as const, ref: m.number, name: m.name, status: m.status, matches: matchingFields(self, { tpin: m.tpin, pacra: m.pacra, name: m.name, email: m.contactEmail, phone: m.contactPhone }) })),
    ...apps.map(x => ({ type: 'application' as const, ref: x.ref, name: x.businessName, status: x.stage, matches: matchingFields(self, { tpin: x.tpin, pacra: x.pacra, name: x.businessName, email: x.email, phone: x.phone }) })),
  ].filter(d => d.matches.length);
  const missingDocuments = requiredDocuments(a.stage).filter(k => !kinds.some(kind => kind === k));
  const tpinValid = tpinLooksValid(a.tpin);
  const flags = checkFlags({ tpinValid, duplicates: duplicates.length, missingDocuments: missingDocuments.length });
  return { tpinValid, duplicates, missingDocuments, flags };
}

export async function detail(ref: string) {
  const a = await prisma.application.findUnique({
    where: { ref: ref.toUpperCase() },
    include: {
      recommendedBy: { select: { id: true, name: true, title: true, role: true } }, approvedBy: { select: { name: true } },
      documents: { orderBy: { createdAt: 'asc' } }, member: { select: { number: true } },
    },
  });
  if (!a) throw notFound(`Application ${ref}`);
  const [c, trail, f, payments] = await Promise.all([checks(prisma, a), trailFor(a.ref), applicationFees(prisma, a.tierName), paymentsFor({ applicationId: a.id })]);
  return {
    ref: a.ref, stage: a.stage, displayStage: displayStage(a), submittedAt: a.submittedAt,
    business: { name: a.businessName, town: a.town, province: a.province, address: a.address, pacra: a.pacra, tpin: a.tpin, tier: a.tierName },
    contact: { name: a.contactName, position: a.position, phone: a.phone, email: a.email },
    director: { name: a.directorName, nrc: a.directorNrc },
    mofRef: a.mofRef, mofExpiry: a.mofExpiry, returnNote: a.returnNote, rejectionReason: a.rejectionReason,
    recommendation: a.recommendedBy && { by: a.recommendedBy.name, title: a.recommendedBy.title, userId: a.recommendedBy.id, at: a.recommendedAt, note: a.recommendationNote },
    approval: a.approvedBy && { by: a.approvedBy.name, at: a.approvedAt },
    documents: a.documents.map(d => ({ id: d.id, kind: d.kind, filename: d.filename, mimeType: d.mimeType, size: d.size, superseded: d.superseded, uploadedAt: d.createdAt })),
    payments: await viewsOf(payments),
    fees: f, memberNumber: a.member?.number ?? null, checks: c, audit: trail,
  };
}

const recommendSchema = z.object({ note: z.string().trim().max(1000).default(''), mofExpiry: s.date });

/** The maker step: an officer verifies the MoF authorization and recommends approval. */
export async function recommend(user: AuthUser, actor: Actor, ref: string, body: unknown) {
  const v = recommendSchema.parse(body);
  const mofExpiry = dateOnly(v.mofExpiry);
  if (mofExpiry <= today()) throw badRequest('The MoF authorization has expired. Return the application to the applicant instead.');
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (a.stage !== 'MOF_REVIEW') throw conflict('Only applications in MoF review can be recommended.');
    if (a.recommendedById) throw conflict('This application has already been recommended.');
    const c = await checks(tx, a);
    if (c.flags.length && v.note.length < MIN_JUSTIFICATION) throw badRequest(`Automated checks flagged: ${c.flags.join(', ')}. Explain in your note why you still recommend approval.`, { flags: c.flags });
    await tx.application.update({ where: { id: a.id }, data: { recommendedById: user.id, recommendedAt: new Date(), recommendationNote: v.note, mofExpiry } });
    await audit(tx, actor, a.ref, 'Recommended for approval', v.note);
  });
}

/** The checker step. The approver must be a different person from the officer who recommended. */
export async function approve(user: AuthUser, actor: Actor, ref: string) {
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (a.stage !== 'MOF_REVIEW' || !a.recommendedById) throw conflict('Only recommended applications can be approved.');
    if (isOwnRecommendation(a, user.id)) throw forbidden('A different officer must approve your own recommendation.', 'MAKER_CHECKER');
    const recommender = await tx.user.findUniqueOrThrow({ where: { id: a.recommendedById } });
    await tx.application.update({ where: { id: a.id }, data: { stage: 'PAYMENT_PENDING', approvedById: user.id, approvedAt: new Date(), returnNote: null } });
    const f = await applicationFees(tx, a.tierName);
    await audit(tx, actor, a.ref, 'Approved (checker)', `Recommended by ${recommender.name}`);
    await audit(tx, SYSTEM, a.ref, 'Payment link sent', `${K(f.total)} by email and SMS to ${a.email}`);
    await notify(tx, { email: a.email, phone: a.phone }, applicationMessages.approved(a, f.total, trackingUrl(a.ref)));
  });
}

export async function declineRecommendation(actor: Actor, ref: string, reason: string) {
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (a.stage !== 'MOF_REVIEW' || !a.recommendedById) throw conflict('There is no recommendation to decline.');
    const recommender = await tx.user.findUniqueOrThrow({ where: { id: a.recommendedById } });
    await tx.application.update({ where: { id: a.id }, data: { recommendedById: null, recommendedAt: null, recommendationNote: null } });
    await audit(tx, actor, a.ref, 'Recommendation declined (checker)', `${reason} · returned to ${recommender.name}`);
    await notify(tx, { email: recommender.email }, applicationMessages.recommendationDeclined(a, actor.label, reason));
  });
}

/** Sends the application back to the applicant for a (new) MoF authorization. */
export async function returnToApplicant(actor: Actor, ref: string, reason: string) {
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (a.stage !== 'MOF_REVIEW') throw conflict('Only applications in MoF review can be returned.');
    await supersedeMofDocuments(tx, a.id);
    await tx.application.update({
      where: { id: a.id },
      data: { stage: 'DETAILS', returnNote: reason, mofRef: null, mofExpiry: null, recommendedById: null, recommendedAt: null, recommendationNote: null },
    });
    await audit(tx, actor, a.ref, 'Returned to applicant', reason);
    await notify(tx, { email: a.email, phone: a.phone }, applicationMessages.returned(a, reason, trackingUrl(a.ref)));
  });
}

export async function reject(actor: Actor, ref: string, reason: string) {
  return prisma.$transaction(async tx => {
    // Take the application's payment lock (as "pay now" does), then re-read: a payment cannot start mid-rejection.
    const { id } = await appByRef(tx, ref);
    await lockPayments(tx, { applicationId: id });
    const a = await tx.application.findUniqueOrThrow({ where: { id } });
    if (!isOpen(a.stage)) throw conflict('This application is already closed.');
    if (await tx.payment.findFirst({ where: { applicationId: a.id, status: 'PENDING' } })) throw conflict('A payment is in progress for this application. Resolve it first.');
    await tx.application.update({ where: { id: a.id }, data: { stage: 'REJECTED', rejectionReason: reason } });
    await audit(tx, actor, a.ref, 'Application rejected', reason);
    await notify(tx, { email: a.email }, applicationMessages.rejected(a, reason));
  });
}

export async function recordOfflinePayment(actor: Actor, ref: string, v: OfflinePayment) {
  const a = await appByRef(prisma, ref);
  if (a.stage !== 'PAYMENT_PENDING') throw conflict('This application is not awaiting payment.');
  const f = await applicationFees(prisma, a.tierName);
  const p = await prisma.$transaction(async tx => {
    await guardPending(tx, { applicationId: a.id });
    await assertStage(tx, a.id, 'PAYMENT_PENDING', 'This application is not awaiting payment.');
    return recordOffline(tx, actor, { purpose: 'APPLICATION', applicationId: a.id, payerName: a.businessName, method: v.method, bankRef: v.reference, lines: applicationLines(a, f) });
  });
  const member = await memberForApplication(a.id);
  return { payment: await paymentView(p), memberNumber: member?.number ?? null, amount: num(p.amount) };
}

/**
 * What a settled application payment does: a paid application awaiting payment becomes a member (accreditation);
 * money for an application in any other stage is flagged for staff to check whether a refund is due.
 */
export const applicationSettlement: SettlementHandler = {
  async paid(tx, p) {
    const a = p.application;
    if (!a) return;
    if (a.stage !== 'PAYMENT_PENDING') {
      await audit(tx, SYSTEM, a.ref, 'Payment needs review', `${p.ref} received while the application is ${a.stage}; check whether a refund is due`);
      return;
    }
    await tx.application.update({ where: { id: a.id }, data: { stage: 'ACCREDITED' } });
    await accreditApplication(tx, a, p);
  },
  released: async () => {},
};

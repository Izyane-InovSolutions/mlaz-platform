import { z } from 'zod';
import type { Application, ApplicationStage, Prisma as P } from '../generated/prisma/client.js';
import { type Actor, applicantActor, audit } from '../lib/audit.js';
import type { AuthUser } from '../lib/auth.js';
import { dateOnly, today } from '../lib/dates.js';
import { type Db, prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { nextRef } from '../lib/ids.js';
import { K, num } from '../lib/money.js';
import { type UploadedFile, requireFile, storeFile } from '../lib/uploads.js';
import { s } from '../lib/validate.js';
import { checkTrackingToken, trackingToken, trackingUrl } from '../lib/tokens.js';
import { T, notify } from './notifications.js';
import { type Checkout, createPayment, guardPending, initiate, paymentView, recordOffline } from './payments.js';
import { fees, tierDues } from './settings.js';

// Application journey: DETAILS → MOF_REVIEW → (recommended by a maker, approved by a different checker) → PAYMENT_PENDING
// → ACCREDITED (automatically, when payment succeeds). Staff can return an application to DETAILS or reject it.

const OPEN: ApplicationStage[] = ['DETAILS', 'MOF_REVIEW', 'PAYMENT_PENDING'];

export const submitSchema = z.object({
  name: s.text(200),
  pacra: s.pacra,
  tpin: s.tpin,
  town: s.text(100),
  province: s.province,
  address: s.optionalText(300),
  tier: s.text(40),
  contact: s.text(120),
  position: s.text(120),
  phone: s.phone,
  email: s.email,
  director: s.text(120),
  directorNrc: s.nrc,
  mofRef: s.optionalText(60),
  declare: z.enum(['true', 'on', '1'], { message: 'Confirm the declaration to submit' }),
});

const appByRef = async (db: Db, ref: string) => {
  const a = await db.application.findUnique({ where: { ref: ref.trim().toUpperCase() } });
  if (!a) throw notFound(`Application ${ref}`);
  return a;
};

export async function applicationFees(db: Db, tierName: string) {
  const { joiningFee } = await fees(db);
  const annualDues = await tierDues(db, tierName);
  return { joiningFee, annualDues, total: joiningFee + annualDues };
}

/* ================= APPLICANT (public, with tracking token) ================= */

export async function submit(fields: Record<string, string>, files: Record<string, UploadedFile>, ip: string) {
  const d = submitSchema.parse(fields);
  const tier = await prisma.tier.findUnique({ where: { name: d.tier } });
  if (!tier?.active) throw badRequest(`Unknown membership tier ${d.tier}.`);
  const mofFile = files.mofFile;
  if (mofFile && !d.mofRef) throw badRequest('Enter the authorization reference for the MoF document you attached.');
  if (d.mofRef && !mofFile) throw badRequest('Attach the MoF authorization document, or leave the reference blank and upload both later.');

  // Store files first so the transaction stays short.
  const stored = [
    await storeFile(requireFile(files, 'pacraFile', 'PACRA certificate of incorporation'), 'PACRA_CERTIFICATE'),
    await storeFile(requireFile(files, 'nrcFile', 'copy of the director’s NRC'), 'DIRECTOR_NRC'),
    ...(mofFile ? [await storeFile(mofFile, 'MOF_AUTHORIZATION')] : []),
  ];
  const hasMof = !!mofFile;
  const actor = applicantActor(d.contact, ip);

  const app = await prisma.$transaction(async tx => {
    const a = await tx.application.create({
      data: {
        ref: await nextRef(tx, 'application'),
        businessName: d.name, pacra: d.pacra, tpin: d.tpin, town: d.town, province: d.province, address: d.address, tierName: tier.name,
        contactName: d.contact, position: d.position, phone: d.phone, email: d.email, directorName: d.director, directorNrc: d.directorNrc,
        mofRef: hasMof ? d.mofRef : null, stage: hasMof ? 'MOF_REVIEW' : 'DETAILS',
      },
    });
    await tx.document.createMany({ data: stored.map(f => ({ ...f, applicationId: a.id, uploadedBy: actor.label })) });
    await audit(tx, actor, a.ref, 'Application submitted', hasMof ? 'MoF authorization, PACRA certificate and director NRC uploaded' : 'PACRA certificate and director NRC uploaded · MoF authorization to follow');
    await notify(tx, { email: a.email, phone: a.phone }, T.applicationReceived({ ...a, hasMof }, trackingUrl(a.ref)));
    return a;
  });
  return { ref: app.ref, stage: app.stage, trackingToken: trackingToken(app.ref), trackUrl: trackingUrl(app.ref) };
}

/** Loads an application for its applicant. A wrong token gets the same 404 as a missing reference. */
export async function forApplicant(ref: string, token: unknown) {
  const a = await prisma.application.findUnique({ where: { ref: ref.trim().toUpperCase() } });
  if (!a || !checkTrackingToken(a.ref, token)) throw notFound(`Application ${ref}`);
  return a;
}

export async function applicantView(a: Application) {
  const [payment, member, f] = await Promise.all([
    prisma.payment.findFirst({
      where: { applicationId: a.id, status: { in: ['PENDING', 'SUCCESS'] } }, orderBy: { createdAt: 'desc' },
      include: { lines: true, documents: { select: { id: true } }, application: true, member: true, registration: { include: { event: true } } },
    }),
    prisma.member.findUnique({ where: { applicationId: a.id }, include: { certificates: { orderBy: { issuedAt: 'desc' }, take: 1 } } }),
    applicationFees(prisma, a.tierName),
  ]);
  return {
    ref: a.ref, businessName: a.businessName, town: a.town, province: a.province, tier: a.tierName, stage: a.stage,
    submittedAt: a.submittedAt, mofRef: a.mofRef, returnNote: a.returnNote, rejectionReason: a.rejectionReason,
    contactEmail: a.email, fees: f,
    payment: payment ? await paymentView(payment) : null,
    member: member && { number: member.number, certificateSerial: member.certificates[0]?.serial ?? null },
  };
}

export async function uploadMof(a: Application, mofRef: string, file: UploadedFile, ip: string) {
  if (a.stage !== 'DETAILS') throw conflict('This application is not waiting for a MoF authorization.');
  const stored = await storeFile(file, 'MOF_AUTHORIZATION');
  const actor = applicantActor(a.contactName, ip);
  await prisma.$transaction(async tx => {
    await tx.document.updateMany({ where: { applicationId: a.id, kind: 'MOF_AUTHORIZATION' }, data: { superseded: true } });
    await tx.document.create({ data: { ...stored, applicationId: a.id, uploadedBy: actor.label } });
    await tx.application.update({ where: { id: a.id }, data: { stage: 'MOF_REVIEW', mofRef, returnNote: null } });
    await audit(tx, actor, a.ref, 'MoF authorization uploaded', mofRef);
  });
}

export async function startPayment(a: Application, checkout: Checkout) {
  if (a.stage !== 'PAYMENT_PENDING') throw conflict('This application is not awaiting payment.');
  const f = await applicationFees(prisma, a.tierName);
  const payment = await prisma.$transaction(async tx => {
    await guardPending(tx, { applicationId: a.id });
    return createPayment(tx, {
      purpose: 'APPLICATION', applicationId: a.id, payerName: a.businessName, method: checkout.method, msisdn: checkout.msisdn,
      lines: [
        { type: 'JOINING_FEE', description: 'Joining fee', unitAmount: f.joiningFee },
        { type: 'DUES', description: `Annual dues (${a.tierName})`, unitAmount: f.annualDues },
      ],
    });
  });
  return initiate(payment.id);
}

/* ================= SECRETARIAT ================= */

/** What the console shows for a stage: an application in MoF review with a recommendation is "awaiting approval". */
const displayStage = (a: Application) => (a.stage === 'MOF_REVIEW' && a.recommendedById ? 'AWAITING_APPROVAL' : a.stage);

export async function list(q: { stage?: string; q?: string; page: number; pageSize: number }) {
  const where: P.ApplicationWhereInput = {};
  if (q.stage === 'OPEN') where.stage = { in: OPEN };
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
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const digits = (v: string) => v.replace(/\D/g, '').slice(-9);
  const match = (r: { tpin: string; pacra: string; name: string; email: string; phone: string }) => [
    r.tpin === a.tpin && 'TPIN', r.pacra && r.pacra === a.pacra && 'PACRA no.', norm(r.name) === norm(a.businessName) && 'business name',
    r.email.toLowerCase() === a.email.toLowerCase() && 'email', digits(r.phone) === digits(a.phone) && 'phone',
  ].filter((x): x is string => !!x);

  // Sequential on purpose: `db` may be a transaction client, which must not run queries concurrently.
  const or = [{ tpin: a.tpin }, { pacra: a.pacra }];
  const members = await db.member.findMany({ where: { OR: [...or, { contactEmail: { equals: a.email, mode: 'insensitive' } }, { name: { equals: a.businessName, mode: 'insensitive' } }], NOT: { applicationId: a.id } } });
  const apps = await db.application.findMany({ where: { id: { not: a.id }, stage: { in: OPEN }, OR: [...or, { email: { equals: a.email, mode: 'insensitive' } }, { businessName: { equals: a.businessName, mode: 'insensitive' } }] } });
  const docs = await db.document.findMany({ where: { applicationId: a.id, superseded: false }, select: { kind: true } });
  const duplicates = [
    ...members.map(m => ({ type: 'member' as const, ref: m.number, name: m.name, status: m.status, matches: match({ tpin: m.tpin, pacra: m.pacra, name: m.name, email: m.contactEmail, phone: m.contactPhone }) })),
    ...apps.map(x => ({ type: 'application' as const, ref: x.ref, name: x.businessName, status: x.stage, matches: match({ tpin: x.tpin, pacra: x.pacra, name: x.businessName, email: x.email, phone: x.phone }) })),
  ].filter(d => d.matches.length);
  const required = ['PACRA_CERTIFICATE', 'DIRECTOR_NRC', ...(a.stage === 'DETAILS' ? [] : ['MOF_AUTHORIZATION'])];
  const missingDocuments = required.filter(k => !docs.some(d => d.kind === k));
  const tpinValid = /^\d{10}$/.test(a.tpin); // placeholder until the ZRA TPIN lookup is connected
  const flags = [!tpinValid && 'TPIN not verified', duplicates.length && 'possible duplicate', missingDocuments.length && 'documents incomplete'].filter((x): x is string => !!x);
  return { tpinValid, duplicates, missingDocuments, flags };
}

export async function detail(ref: string) {
  const a = await prisma.application.findUnique({
    where: { ref: ref.toUpperCase() },
    include: {
      recommendedBy: { select: { id: true, name: true, title: true, role: true } }, approvedBy: { select: { name: true } },
      documents: { orderBy: { createdAt: 'asc' } }, member: { select: { number: true } },
      payments: { orderBy: { createdAt: 'desc' }, include: { lines: true, documents: { select: { id: true } }, application: true, member: true, registration: { include: { event: true } } } },
    },
  });
  if (!a) throw notFound(`Application ${ref}`);
  const [c, trail, f] = await Promise.all([checks(prisma, a), prisma.auditLog.findMany({ where: { target: a.ref }, orderBy: { at: 'desc' } }), applicationFees(prisma, a.tierName)]);
  return {
    ref: a.ref, stage: a.stage, displayStage: displayStage(a), submittedAt: a.submittedAt,
    business: { name: a.businessName, town: a.town, province: a.province, address: a.address, pacra: a.pacra, tpin: a.tpin, tier: a.tierName },
    contact: { name: a.contactName, position: a.position, phone: a.phone, email: a.email },
    director: { name: a.directorName, nrc: a.directorNrc },
    mofRef: a.mofRef, mofExpiry: a.mofExpiry, returnNote: a.returnNote, rejectionReason: a.rejectionReason,
    recommendation: a.recommendedBy && { by: a.recommendedBy.name, title: a.recommendedBy.title, userId: a.recommendedBy.id, at: a.recommendedAt, note: a.recommendationNote },
    approval: a.approvedBy && { by: a.approvedBy.name, at: a.approvedAt },
    documents: a.documents.map(d => ({ id: d.id, kind: d.kind, filename: d.filename, mimeType: d.mimeType, size: d.size, superseded: d.superseded, uploadedAt: d.createdAt })),
    payments: await Promise.all(a.payments.map(paymentView)),
    fees: f, memberNumber: a.member?.number ?? null, checks: c, audit: trail,
  };
}

const recommendSchema = z.object({ note: z.string().trim().max(1000).default(''), mofExpiry: s.date });
export async function recommend(user: AuthUser, actor: Actor, ref: string, body: unknown) {
  const v = recommendSchema.parse(body);
  const mofExpiry = dateOnly(v.mofExpiry);
  if (mofExpiry <= today()) throw badRequest('The MoF authorization has expired. Return the application to the applicant instead.');
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (a.stage !== 'MOF_REVIEW') throw conflict('Only applications in MoF review can be recommended.');
    if (a.recommendedById) throw conflict('This application has already been recommended.');
    const c = await checks(tx, a);
    if (c.flags.length && v.note.length < 10) throw badRequest(`Automated checks flagged: ${c.flags.join(', ')}. Explain in your note why you still recommend approval.`, { flags: c.flags });
    await tx.application.update({ where: { id: a.id }, data: { recommendedById: user.id, recommendedAt: new Date(), recommendationNote: v.note, mofExpiry } });
    await audit(tx, actor, a.ref, 'Recommended for approval', v.note);
  });
}

/** The checker step. The approver must be a different person from the officer who recommended. */
export async function approve(user: AuthUser, actor: Actor, ref: string) {
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (a.stage !== 'MOF_REVIEW' || !a.recommendedById) throw conflict('Only recommended applications can be approved.');
    if (a.recommendedById === user.id) throw forbidden('A different officer must approve your own recommendation.', 'MAKER_CHECKER');
    const recommender = await tx.user.findUniqueOrThrow({ where: { id: a.recommendedById } });
    await tx.application.update({ where: { id: a.id }, data: { stage: 'PAYMENT_PENDING', approvedById: user.id, approvedAt: new Date(), returnNote: null } });
    const f = await applicationFees(tx, a.tierName);
    await audit(tx, actor, a.ref, 'Approved (checker)', `Recommended by ${recommender.name}`);
    await audit(tx, { type: 'SYSTEM', label: 'System' }, a.ref, 'Payment link sent', `${K(f.total)} by email and SMS to ${a.email}`);
    await notify(tx, { email: a.email, phone: a.phone }, T.applicationApproved(a, f.total, trackingUrl(a.ref)));
  });
}

export async function declineRecommendation(actor: Actor, ref: string, reason: string) {
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (a.stage !== 'MOF_REVIEW' || !a.recommendedById) throw conflict('There is no recommendation to decline.');
    const recommender = await tx.user.findUniqueOrThrow({ where: { id: a.recommendedById } });
    await tx.application.update({ where: { id: a.id }, data: { recommendedById: null, recommendedAt: null, recommendationNote: null } });
    await audit(tx, actor, a.ref, 'Recommendation declined (checker)', `${reason} · returned to ${recommender.name}`);
    await notify(tx, { email: recommender.email }, { subject: `Recommendation declined: ${a.ref}`, text: `${actor.label} declined your recommendation for ${a.businessName} (${a.ref}):\n\n${reason}` });
  });
}

/** Sends the application back to the applicant for a (new) MoF authorization. */
export async function returnToApplicant(actor: Actor, ref: string, reason: string) {
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (a.stage !== 'MOF_REVIEW') throw conflict('Only applications in MoF review can be returned.');
    await tx.document.updateMany({ where: { applicationId: a.id, kind: 'MOF_AUTHORIZATION' }, data: { superseded: true } });
    await tx.application.update({
      where: { id: a.id },
      data: { stage: 'DETAILS', returnNote: reason, mofRef: null, mofExpiry: null, recommendedById: null, recommendedAt: null, recommendationNote: null },
    });
    await audit(tx, actor, a.ref, 'Returned to applicant', reason);
    await notify(tx, { email: a.email, phone: a.phone }, T.applicationReturned(a, reason, trackingUrl(a.ref)));
  });
}

export async function reject(actor: Actor, ref: string, reason: string) {
  return prisma.$transaction(async tx => {
    const a = await appByRef(tx, ref);
    if (!OPEN.includes(a.stage)) throw conflict('This application is already closed.');
    if (await tx.payment.findFirst({ where: { applicationId: a.id, status: 'PENDING' } })) throw conflict('A payment is in progress for this application. Resolve it first.');
    await tx.application.update({ where: { id: a.id }, data: { stage: 'REJECTED', rejectionReason: reason } });
    await audit(tx, actor, a.ref, 'Application rejected', reason);
    await notify(tx, { email: a.email }, T.applicationRejected(a, reason));
  });
}

export async function recordOfflinePayment(actor: Actor, ref: string, v: { method: 'BANK_TRANSFER' | 'CASH'; reference: string }) {
  const a = await appByRef(prisma, ref);
  if (a.stage !== 'PAYMENT_PENDING') throw conflict('This application is not awaiting payment.');
  const f = await applicationFees(prisma, a.tierName);
  const p = await prisma.$transaction(async tx => {
    await guardPending(tx, { applicationId: a.id });
    return recordOffline(tx, actor, {
      purpose: 'APPLICATION', applicationId: a.id, payerName: a.businessName, method: v.method, bankRef: v.reference,
      lines: [
        { type: 'JOINING_FEE', description: 'Joining fee', unitAmount: f.joiningFee },
        { type: 'DUES', description: `Annual dues (${a.tierName})`, unitAmount: f.annualDues },
      ],
    });
  });
  const member = await prisma.member.findUnique({ where: { applicationId: a.id }, select: { number: true } });
  return { payment: await paymentView(p), memberNumber: member?.number ?? null, amount: num(p.amount) };
}

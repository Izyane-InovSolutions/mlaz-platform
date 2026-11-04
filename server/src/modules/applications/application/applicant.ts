import { z } from 'zod';
import type { Application } from '../../../generated/prisma/client.js';
import { applicantActor } from '../../../shared/actor.js';
import { type Db, type Tx, prisma } from '../../../shared/db.js';
import { badRequest, conflict, notFound } from '../../../shared/errors.js';
import { nextRef } from '../../../shared/ids.js';
import { s } from '../../../shared/validation.js';
import { fees, findTier, tierDues } from '../../administration/index.js';
import { audit } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { type StoredFile, type UploadedFile, commitFiles, recordDocument, recordDocuments, requireFile, storeFile, storeFiles, supersedeMofDocuments } from '../../documents/index.js';
import { memberForApplication } from '../../membership/index.js';
import { type Checkout, attachProof, createPayment, guardPending, initiate, latestPayment, ownedPayment, paymentView } from '../../payments/index.js';
import type { ApplicationStage } from '../domain/journey.js';
import { applicationMessages } from './messages.js';
import { checkTrackingToken, trackingToken, trackingUrl } from './tracking.js';

// The applicant's side, on the public website: no account, only the tracking token from the confirmation or email.

export const submitSchema = z.object({
  name: s.name(200),
  pacra: s.pacra,
  tpin: s.tpin,
  town: s.name(100),
  province: s.province,
  address: s.optionalText(300),
  tier: s.text(40),
  contact: s.name(120),
  position: s.name(120),
  phone: s.phone,
  email: s.email,
  director: s.name(120),
  directorNrc: s.nrc,
  mofRef: s.optionalText(60),
  declare: z.enum(['true', 'on', '1'], { message: 'Confirm the declaration to submit' }),
});

export async function applicationFees(db: Db, tierName: string) {
  const { joiningFee } = await fees(db);
  const annualDues = await tierDues(db, tierName);
  return { joiningFee, annualDues, total: joiningFee + annualDues };
}

/** The payment lines for an application: the joining fee and the first year's dues. */
export const applicationLines = (a: Pick<Application, 'tierName'>, f: Awaited<ReturnType<typeof applicationFees>>) => [
  { type: 'JOINING_FEE' as const, description: 'Joining fee', unitAmount: f.joiningFee },
  { type: 'DUES' as const, description: `Annual dues (${a.tierName})`, unitAmount: f.annualDues },
];

export async function submit(fields: Record<string, string>, files: Record<string, UploadedFile>, ip: string) {
  const d = submitSchema.parse(fields);
  const tier = await findTier(prisma, d.tier);
  if (!tier?.active) throw badRequest(`Unknown membership tier ${d.tier}.`);
  const mofFile = files.mofFile;
  if (mofFile && !d.mofRef) throw badRequest('Enter the authorization reference for the MoF document you attached.');
  if (d.mofRef && !mofFile) throw badRequest('Attach the MoF authorization document, or leave the reference blank and upload both later.');

  // Store files first so the transaction stays short. Every required file is checked before any is stored, and the
  // stored files are removed again if the application cannot be recorded.
  const stored = await storeFiles([
    [requireFile(files, 'pacraFile', 'PACRA certificate of incorporation'), 'PACRA_CERTIFICATE'] as const,
    [requireFile(files, 'nrcFile', 'copy of the director’s NRC'), 'DIRECTOR_NRC'] as const,
    ...(mofFile ? [[mofFile, 'MOF_AUTHORIZATION'] as const] : []),
  ]);
  const hasMof = !!mofFile;
  const actor = applicantActor(d.contact, ip);

  const app = await commitFiles(stored, () => prisma.$transaction(async tx => {
    const a = await tx.application.create({
      data: {
        ref: await nextRef(tx, 'application'),
        businessName: d.name, pacra: d.pacra, tpin: d.tpin, town: d.town, province: d.province, address: d.address, tierName: tier.name,
        contactName: d.contact, position: d.position, phone: d.phone, email: d.email, directorName: d.director, directorNrc: d.directorNrc,
        mofRef: hasMof ? d.mofRef : null, stage: hasMof ? 'MOF_REVIEW' : 'DETAILS',
      },
    });
    await recordDocuments(tx, stored, { applicationId: a.id }, actor.label);
    await audit(tx, actor, a.ref, 'Application submitted', hasMof ? 'MoF authorization, PACRA certificate and director NRC uploaded' : 'PACRA certificate and director NRC uploaded · MoF authorization to follow');
    await notify(tx, { email: a.email, phone: a.phone }, applicationMessages.received({ ...a, hasMof }, trackingUrl(a.ref)));
    return a;
  }));
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
    latestPayment({ applicationId: a.id }, ['PENDING', 'SUCCESS']),
    memberForApplication(a.id),
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
  await commitFiles([stored], () => prisma.$transaction(async tx => {
    // The stage is checked again as part of the write: a rejection that landed during the upload must not be undone.
    const moved = await tx.application.updateMany({ where: { id: a.id, stage: 'DETAILS' }, data: { stage: 'MOF_REVIEW', mofRef, returnNote: null } });
    if (!moved.count) throw conflict('This application is not waiting for a MoF authorization.');
    await supersedeMofDocuments(tx, a.id);
    await recordDocument(tx, stored, { applicationId: a.id }, actor.label);
    await audit(tx, actor, a.ref, 'MoF authorization uploaded', mofRef);
  }));
}

/** Re-reads the stage inside a transaction that holds the application's payment lock. */
export async function assertStage(tx: Tx, applicationId: string, stage: ApplicationStage, message: string) {
  const { stage: now } = await tx.application.findUniqueOrThrow({ where: { id: applicationId }, select: { stage: true } });
  if (now !== stage) throw conflict(message);
}

export async function startPayment(a: Application, checkout: Checkout) {
  if (a.stage !== 'PAYMENT_PENDING') throw conflict('This application is not awaiting payment.');
  const f = await applicationFees(prisma, a.tierName);
  const payment = await prisma.$transaction(async tx => {
    await guardPending(tx, { applicationId: a.id });
    await assertStage(tx, a.id, 'PAYMENT_PENDING', 'This application is not awaiting payment.');
    return createPayment(tx, {
      purpose: 'APPLICATION', applicationId: a.id, payerName: a.businessName, method: checkout.method, msisdn: checkout.msisdn,
      lines: applicationLines(a, f),
    });
  });
  return initiate(payment.id);
}

/** One of this application's payments, by reference. */
export const applicantPayment = (a: Application, payRef: string) => ownedPayment(payRef, { applicationId: a.id });

/** Attaches proof of payment to a payment already checked with applicantPayment (before the upload was read). */
export async function attachApplicantProof(a: Application, paymentId: string, bankRef: string, stored: StoredFile, ip: string) {
  return paymentView(await commitFiles([stored], () => attachProof(applicantActor(a.contactName, ip), paymentId, bankRef, stored)));
}

/** Re-sends the tracking link to the applicant's email, only when the address matches. Says nothing either way. */
export async function resendTrackingLink(ref: string, email: string) {
  const a = await prisma.application.findUnique({ where: { ref: ref.toUpperCase() } });
  if (a && a.email.toLowerCase() === email) await notify(prisma, { email: a.email }, applicationMessages.trackingLink(a.ref, trackingUrl(a.ref)));
}

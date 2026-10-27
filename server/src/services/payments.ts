import { z } from 'zod';
import type { LineType, Payment, PaymentMethod, PaymentPurpose, PaymentStatus, Prisma as P } from '../generated/prisma/client.js';
import { type Actor, SYSTEM, activity, audit } from '../lib/audit.js';
import { type Tx, lockKey, prisma } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { nextRef } from '../lib/ids.js';
import { K, num, sum } from '../lib/money.js';
import type { StoredFile } from '../lib/uploads.js';
import { s } from '../lib/validate.js';
import { gateway, providerByName } from '../providers/payments.js';
import { accreditApplication, applyDues } from './membership.js';
import { T, notify } from './notifications.js';
import { getSetting } from './settings.js';

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  MTN_MOMO: 'MTN MoMo', AIRTEL_MONEY: 'Airtel Money', ZAMTEL_KWACHA: 'Zamtel Kwacha', IZYANE_QR: 'iZyane Pay QR',
  CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash',
};
export const ONLINE_METHODS = ['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA', 'IZYANE_QR', 'CARD', 'BANK_TRANSFER'] as const;
const MOBILE_MONEY = new Set<PaymentMethod>(['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA']);
export const isGatewayMethod = (m: PaymentMethod) => m !== 'BANK_TRANSFER' && m !== 'CASH';

/** Body of every "pay now" endpoint. */
export const checkoutSchema = z.object({
  method: z.enum(ONLINE_METHODS),
  msisdn: s.msisdn.optional(),
}).refine(v => !MOBILE_MONEY.has(v.method) || v.msisdn, { message: 'Enter the mobile money number to charge', path: ['msisdn'] });
export type Checkout = z.infer<typeof checkoutSchema>;

export const offlineSchema = z.object({ method: z.enum(['BANK_TRANSFER', 'CASH']), reference: s.text(80) });

// A gateway payment not settled within this time is marked failed; a later success from the gateway is still honoured.
const EXPIRED_REASON = 'No confirmation from the payment provider (timed out)';
const REPLACED_REASON = 'Replaced by a new payment attempt';
/** Set on pending event payments when the event is cancelled. A late success is still recorded, and flagged for refund. */
export const EVENT_CANCELLED_REASON = 'Event cancelled';
// Payments the server gave up on although the payer may still approve them at the gateway.
const LATE_SUCCESS_REASONS = new Set([EXPIRED_REASON, REPLACED_REASON, EVENT_CANCELLED_REASON]);
const GATEWAY_TIMEOUT_MIN = 30;
const IN_PROGRESS_MIN = 3;
const BANK_PROOF_DAYS = 7;

const FULL = { lines: true, documents: { select: { id: true } }, application: true, member: true, registration: { include: { event: true } } } as const;
type FullPayment = P.PaymentGetPayload<{ include: typeof FULL }>;

interface LineInput { type: LineType; description: string; quantity?: number; unitAmount: number }
interface NewPayment {
  purpose: PaymentPurpose;
  applicationId?: string;
  memberId?: string;
  registrationId?: string;
  payerName: string;
  method: PaymentMethod;
  msisdn?: string;
  bankRef?: string;
  recordedBy?: string;
  lines: LineInput[];
}

export async function createPayment(tx: Tx, p: NewPayment) {
  const lines = p.lines.map(l => {
    const quantity = l.quantity ?? 1;
    return { type: l.type, description: l.description, quantity, unitAmount: l.unitAmount, amount: Math.round(quantity * l.unitAmount * 100) / 100 };
  });
  const { lines: _, ...rest } = p;
  return tx.payment.create({
    data: {
      ...rest,
      ref: await nextRef(tx, 'payment'),
      amount: sum(lines.map(l => l.amount)),
      provider: p.recordedBy ? 'manual' : isGatewayMethod(p.method) ? gateway().name : 'bank',
      lines: { create: lines },
    },
    include: { lines: true },
  });
}

/** Serialises payment decisions for one target, e.g. { applicationId } or { memberId, purpose: 'DUES' }. */
export const lockPayments = (tx: Tx, where: P.PaymentWhereInput) => lockKey(tx, `payments:${JSON.stringify(where)}`);

/**
 * Refuses a second payment for the same thing while one is still in flight, and clears out stale attempts.
 * `where` identifies the target (an application, a member's dues, ...).
 */
export async function guardPending(tx: Tx, where: P.PaymentWhereInput) {
  // Two "pay now" requests for the same target must not both see "nothing pending" and both create a payment.
  await lockPayments(tx, where);
  const pending = await tx.payment.findMany({ where: { ...where, status: 'PENDING' }, include: { documents: { select: { id: true } } } });
  for (const p of pending) {
    if (p.method === 'BANK_TRANSFER' && p.documents.length) throw conflict(`Payment ${p.ref} is awaiting confirmation by MLAZ Finance.`, 'PAYMENT_AWAITING_CONFIRMATION', { ref: p.ref });
    if (p.provider !== 'bank' && Date.now() - p.createdAt.getTime() < IN_PROGRESS_MIN * 60e3) throw conflict(`Payment ${p.ref} is still in progress.`, 'PAYMENT_IN_PROGRESS', { ref: p.ref });
    await tx.payment.update({ where: { id: p.id }, data: { status: 'CANCELLED', failureReason: REPLACED_REASON } });
    if (p.registrationId) await tx.registration.updateMany({ where: { id: p.registrationId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  }
}

/** Sends a committed gateway payment to the provider. Bank transfers just wait for their proof of payment. */
export async function initiate(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { lines: true } });
  if (isGatewayMethod(p.method) && p.status === 'PENDING' && !p.providerRef) {
    try {
      const r = await gateway().initiate({
        ref: p.ref, amount: num(p.amount), method: p.method, msisdn: p.msisdn, payerName: p.payerName,
        description: p.lines.map(l => l.description).join(', '),
      });
      // Only ever send payers to an HTTPS checkout page.
      const checkoutUrl = r.checkoutUrl && /^https:\/\//.test(r.checkoutUrl) ? r.checkoutUrl : undefined;
      await prisma.payment.update({ where: { id: p.id }, data: { providerRef: r.providerRef, checkoutUrl, qrPayload: r.qrPayload } });
      if (r.status !== 'PENDING') await settle(p.id, { status: r.status, failureReason: r.failureReason }, SYSTEM);
    } catch {
      await settle(p.id, { status: 'FAILED', failureReason: 'The payment provider could not be reached. Please try again.' }, SYSTEM);
    }
  }
  return paymentView(await loadPayment(p.id));
}

const loadPayment = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id }, include: FULL });

interface Outcome { status: 'PENDING' | 'SUCCESS' | 'FAILED'; failureReason?: string }

export const settle = (paymentId: string, outcome: Outcome, actor: Actor, reviewedBy?: string) =>
  prisma.$transaction(tx => settleInTx(tx, paymentId, outcome, actor, reviewedBy));

/**
 * Applies a payment outcome exactly once: the row is locked, and an outcome for a payment that is already final is
 * ignored. A success that arrives after the server gave up on the payment (timed out / replaced) is still applied,
 * because the payer's money was taken.
 */
export async function settleInTx(tx: Tx, paymentId: string, outcome: Outcome, actor: Actor, reviewedBy?: string): Promise<FullPayment> {
  const locked = await tx.$queryRaw<{ status: PaymentStatus }[]>`SELECT "status" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  if (!locked.length) throw notFound('Payment');
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: FULL });
  if (outcome.status === 'PENDING') return p;
  const lateSuccess = outcome.status === 'SUCCESS' && p.provider !== 'manual'
    && (p.status === 'CANCELLED' || p.status === 'FAILED') && LATE_SUCCESS_REASONS.has(p.failureReason ?? '');
  if (p.status !== 'PENDING' && !lateSuccess) return p;

  const target = p.application?.ref ?? p.member?.number ?? 'Payments';
  const review = reviewedBy ? { reviewedBy, reviewedAt: new Date() } : {};
  const payer = p.application ? { email: p.application.email, phone: p.application.phone } : p.member ? { email: p.member.contactEmail, phone: p.member.contactPhone } : {};

  if (outcome.status === 'FAILED') {
    const failureReason = outcome.failureReason ?? 'Payment failed';
    await tx.payment.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason, ...review } });
    if (p.registration?.status === 'PENDING') await tx.registration.update({ where: { id: p.registration.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (reviewedBy) {
      await audit(tx, actor, target, 'Proof of payment rejected', `${p.ref} · ${K(p.amount)} · ${failureReason}`);
      await notify(tx, payer, T.paymentRejected(p, failureReason));
    } else {
      await audit(tx, actor, target, 'Payment failed', `${p.ref} · ${K(p.amount)} · ${METHOD_LABEL[p.method]} · ${failureReason}`);
    }
    return loadPaymentTx(tx, p.id);
  }

  await tx.payment.update({ where: { id: p.id }, data: { status: 'SUCCESS', paidAt: new Date(), failureReason: null, ...review } });
  await audit(tx, actor, target, reviewedBy ? 'Bank transfer confirmed' : 'Payment received',
    `${p.ref} · ${K(p.amount)} · ${METHOD_LABEL[p.method]}${p.bankRef ? ` · ref ${p.bankRef}` : ''}${lateSuccess ? ' · late confirmation from provider' : ''}`);

  if (p.purpose === 'APPLICATION' && p.application) {
    if (p.application.stage === 'PAYMENT_PENDING') await accreditApplication(tx, p.application, p);
    else await audit(tx, SYSTEM, target, 'Payment needs review', `${p.ref} received while the application is ${p.application.stage}; check whether a refund is due`);
  }
  if (p.purpose === 'DUES' && p.member) await applyDues(tx, p, p.member);
  if (p.purpose === 'EVENT' && p.registration) await confirmRegistration(tx, p.registration, p);

  await notify(tx, payer, T.receipt({ ...p, methodLabel: METHOD_LABEL[p.method] }));
  return loadPaymentTx(tx, p.id);
}
const loadPaymentTx = (tx: Tx, id: string) => tx.payment.findUniqueOrThrow({ where: { id }, include: FULL });

async function confirmRegistration(tx: Tx, r: NonNullable<FullPayment['registration']>, p: Payment) {
  if (r.status === 'CONFIRMED') return;
  if (r.status === 'CANCELLED') {
    // Late payment for places that were released: honour it only if the event still has room.
    const taken = await tx.registration.aggregate({ where: { eventId: r.eventId, status: { in: ['PENDING', 'CONFIRMED'] } }, _sum: { tickets: true } });
    if (r.event.status !== 'PUBLISHED' || (taken._sum.tickets ?? 0) + r.tickets > r.event.capacity) {
      await tx.registration.update({ where: { id: r.id }, data: { refundDue: true } });
      await audit(tx, SYSTEM, 'Events', 'Refund due', `${p.ref} arrived after the places for ${r.event.name} were released`);
      return;
    }
  }
  await tx.registration.update({ where: { id: r.id }, data: { status: 'CONFIRMED', cancelledAt: null } });
  await activity(tx, r.memberId, 'event_registered', `Registered for ${r.event.name}`, `${r.tickets} ticket(s) · ${K(p.amount)} · ${p.ref}`);
  const m = await tx.member.findUniqueOrThrow({ where: { id: r.memberId } });
  await notify(tx, { email: m.contactEmail }, T.eventRegistered(r.event, r.tickets));
}

/* ================= BANK TRANSFERS ================= */

export async function attachProof(actor: Actor, paymentId: string, bankRef: string, file: StoredFile) {
  return prisma.$transaction(async tx => {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { documents: true, application: true, member: true } });
    if (p.method !== 'BANK_TRANSFER' || p.status !== 'PENDING') throw conflict('Proof of payment can only be added to a pending bank transfer.');
    if (p.documents.length) throw conflict('Proof of payment was already submitted for this payment.');
    await tx.document.create({ data: { ...file, paymentId: p.id, applicationId: p.applicationId, memberId: p.memberId, uploadedBy: actor.label } });
    await tx.payment.update({ where: { id: p.id }, data: { bankRef } });
    await audit(tx, actor, p.application?.ref ?? p.member?.number ?? 'Payments', 'Proof of payment submitted', `${p.ref} · ${K(p.amount)} · bank ref ${bankRef}`);
    return loadPaymentTx(tx, p.id);
  });
}

async function pendingBankPayment(ref: string) {
  const p = await prisma.payment.findUnique({ where: { ref } });
  if (!p) throw notFound(`Payment ${ref}`);
  if (p.method !== 'BANK_TRANSFER' || p.status !== 'PENDING') throw conflict('Only pending bank transfers can be confirmed or rejected.');
  return p;
}

export async function confirmBankTransfer(actor: Actor, ref: string) {
  const p = await pendingBankPayment(ref);
  return paymentView(await settle(p.id, { status: 'SUCCESS' }, actor, actor.label));
}

export async function rejectBankTransfer(actor: Actor, ref: string, reason: string) {
  const p = await pendingBankPayment(ref);
  return paymentView(await settle(p.id, { status: 'FAILED', failureReason: reason }, actor, actor.label));
}

/** Records money received outside the online checkout (cash or a transfer seen on the statement) and applies it. */
export async function recordOffline(tx: Tx, actor: Actor, p: Omit<NewPayment, 'recordedBy' | 'msisdn'>) {
  const payment = await createPayment(tx, { ...p, recordedBy: actor.label });
  return settleInTx(tx, payment.id, { status: 'SUCCESS' }, actor);
}

/* ================= RECONCILIATION ================= */

/** Asks the gateway about every pending online payment and applies final outcomes. */
export async function reconcilePending(actor: Actor = SYSTEM) {
  const pending = await prisma.payment.findMany({ where: { status: 'PENDING', providerRef: { not: null } } });
  let settled = 0;
  for (const p of pending) {
    const provider = providerByName(p.provider);
    if (!provider) continue;
    const outcome = await provider.query({ providerRef: p.providerRef!, createdAt: p.createdAt, msisdn: p.msisdn }).catch(() => null);
    if (outcome && outcome.status !== 'PENDING') {
      await settle(p.id, outcome, actor);
      settled++;
    }
  }
  return { checked: pending.length, settled };
}

export async function expireStale() {
  const gatewayCutoff = new Date(Date.now() - GATEWAY_TIMEOUT_MIN * 60e3);
  const stale = await prisma.payment.findMany({ where: { status: 'PENDING', provider: { notIn: ['bank', 'manual'] }, createdAt: { lt: gatewayCutoff } } });
  for (const p of stale) await settle(p.id, { status: 'FAILED', failureReason: EXPIRED_REASON }, SYSTEM);

  const bankCutoff = new Date(Date.now() - BANK_PROOF_DAYS * 864e5);
  const abandoned = await prisma.payment.findMany({ where: { status: 'PENDING', provider: 'bank', createdAt: { lt: bankCutoff }, documents: { none: {} } } });
  for (const p of abandoned) {
    await prisma.$transaction(async tx => {
      await tx.payment.update({ where: { id: p.id }, data: { status: 'CANCELLED', failureReason: 'No proof of payment was submitted' } });
      if (p.registrationId) await tx.registration.updateMany({ where: { id: p.registrationId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    });
  }
  return stale.length + abandoned.length;
}

export async function handleWebhook(providerName: string, headers: Record<string, unknown>, rawBody: string) {
  const provider = providerByName(providerName);
  if (!provider) throw notFound(`Payment provider ${providerName}`);
  const event = provider.parseWebhook(headers, rawBody);
  const p = await prisma.payment.findUnique({ where: { providerRef: event.providerRef } });
  if (!p || p.provider !== provider.name) throw notFound('Payment');
  const actor = { type: 'SYSTEM' as const, label: `${provider.name} webhook` };
  // A success for a different amount than we asked for is not applied; staff look at it instead.
  if (event.status === 'SUCCESS' && event.amount !== undefined && Math.abs(event.amount - num(p.amount)) > 0.009) {
    await audit(prisma, actor, 'Payments', 'Payment amount mismatch', `${p.ref} · expected ${K(p.amount)}, gateway reported ${K(event.amount)} · not applied`);
    throw conflict('Amount does not match the payment.', 'AMOUNT_MISMATCH');
  }
  await settle(p.id, event, actor);
}

/* ================= VIEWS ================= */

export async function paymentView(p: FullPayment) {
  const awaitingProof = p.method === 'BANK_TRANSFER' && p.status === 'PENDING' && !p.documents.length;
  return {
    ref: p.ref, purpose: p.purpose, status: p.status, method: p.method, methodLabel: METHOD_LABEL[p.method],
    amount: p.amount, payerName: p.payerName,
    lines: p.lines.map(l => ({ type: l.type, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, amount: l.amount })),
    msisdn: p.msisdn, checkoutUrl: p.checkoutUrl, qrPayload: p.qrPayload, bankRef: p.bankRef, failureReason: p.failureReason,
    hasProof: p.documents.length > 0, proofDocumentId: p.documents[0]?.id ?? null, awaitingProof,
    bankAccount: p.method === 'BANK_TRANSFER' && p.status === 'PENDING' ? await getSetting(prisma, 'bankAccount') : undefined,
    applicationRef: p.application?.ref ?? null, memberNumber: p.member?.number ?? null,
    event: p.registration ? { id: p.registration.event.id, name: p.registration.event.name, tickets: p.registration.tickets } : null,
    recordedBy: p.recordedBy, reviewedBy: p.reviewedBy, reviewedAt: p.reviewedAt, createdAt: p.createdAt, paidAt: p.paidAt,
  };
}

export const paymentByRef = async (ref: string) => {
  const p = await prisma.payment.findUnique({ where: { ref: ref.toUpperCase() }, include: FULL });
  if (!p) throw notFound(`Payment ${ref}`);
  return p;
};

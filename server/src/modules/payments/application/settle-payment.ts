import type { PaymentStatus } from '../../../generated/prisma/client.js';
import type { Actor } from '../../../shared/actor.js';
import { type Tx, prisma } from '../../../shared/db.js';
import { notFound } from '../../../shared/errors.js';
import { K } from '../../../shared/money.js';
import { audit } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { METHOD_LABEL, isLateSuccess } from '../domain/payment-rules.js';
import { paymentMessages } from './messages.js';
import { type FullPayment, loadPayment } from './queries.js';
import { settlementHandler } from './settlement-handlers.js';

export interface Outcome { status: 'PENDING' | 'SUCCESS' | 'FAILED'; failureReason?: string }

export const settle = (paymentId: string, outcome: Outcome, actor: Actor, reviewedBy?: string) =>
  prisma.$transaction(tx => settleInTx(tx, paymentId, outcome, actor, reviewedBy));

/**
 * Applies a payment outcome exactly once: the row is locked, and an outcome for a payment that is already final is
 * ignored. A success that arrives after the server gave up on the payment (timed out / replaced) is still applied,
 * because the payer's money was taken. What the payment was for is applied by its purpose's settlement handler.
 */
export async function settleInTx(tx: Tx, paymentId: string, outcome: Outcome, actor: Actor, reviewedBy?: string): Promise<FullPayment> {
  const locked = await tx.$queryRaw<{ status: PaymentStatus }[]>`SELECT "status" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  if (!locked.length) throw notFound('Payment');
  const p = await loadPayment(tx, paymentId);
  if (outcome.status === 'PENDING') return p;
  const lateSuccess = isLateSuccess(p, outcome.status);
  if (p.status !== 'PENDING' && !lateSuccess) return p;

  const handler = settlementHandler(p.purpose);
  const target = p.application?.ref ?? p.member?.number ?? 'Payments';
  const review = reviewedBy ? { reviewedBy, reviewedAt: new Date() } : {};
  const payer = p.application ? { email: p.application.email, phone: p.application.phone } : p.member ? { email: p.member.contactEmail, phone: p.member.contactPhone } : {};

  if (outcome.status === 'FAILED') {
    const failureReason = outcome.failureReason ?? 'Payment failed';
    await tx.payment.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason, ...review } });
    await handler.released(tx, p);
    if (reviewedBy) {
      await audit(tx, actor, target, 'Proof of payment rejected', `${p.ref} · ${K(p.amount)} · ${failureReason}`);
      await notify(tx, payer, paymentMessages.paymentRejected(p, failureReason));
    } else {
      await audit(tx, actor, target, 'Payment failed', `${p.ref} · ${K(p.amount)} · ${METHOD_LABEL[p.method]} · ${failureReason}`);
    }
    return loadPayment(tx, p.id);
  }

  await tx.payment.update({ where: { id: p.id }, data: { status: 'SUCCESS', paidAt: new Date(), failureReason: null, ...review } });
  await audit(tx, actor, target, reviewedBy ? 'Bank transfer confirmed' : 'Payment received',
    `${p.ref} · ${K(p.amount)} · ${METHOD_LABEL[p.method]}${p.bankRef ? ` · ref ${p.bankRef}` : ''}${lateSuccess ? ' · late confirmation from provider' : ''}`);
  await handler.paid(tx, p);
  await notify(tx, payer, paymentMessages.receipt({ ...p, methodLabel: METHOD_LABEL[p.method] }));
  return loadPayment(tx, p.id);
}

/** Closes a payment that will never be completed (no proof of payment arrived), releasing what it held. */
export async function abandon(tx: Tx, p: { id: string; purpose: FullPayment['purpose']; registrationId: string | null }, failureReason: string) {
  await tx.payment.update({ where: { id: p.id }, data: { status: 'CANCELLED', failureReason } });
  await settlementHandler(p.purpose).released(tx, p);
}

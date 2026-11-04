import type { PaymentMethod, PaymentPurpose, Prisma as P } from '../../../generated/prisma/client.js';
import { type Tx, lockKey } from '../../../shared/db.js';
import { conflict } from '../../../shared/errors.js';
import { nextRef } from '../../../shared/ids.js';
import { sum } from '../../../shared/money.js';
import { EVENT_CANCELLED_REASON, IN_PROGRESS_MIN, type LineInput, REPLACED_REASON, isGatewayMethod, priceLines } from '../domain/payment-rules.js';
import { gateway } from '../infrastructure/gateways.js';
import { settlementHandler } from './settlement-handlers.js';

export interface NewPayment {
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
  const lines = priceLines(p.lines);
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
    await settlementHandler(p.purpose).released(tx, p);
  }
}

/** A pending payment for an event that was cancelled. A late success is still recorded (and the place flagged for refund). */
export const cancelForEvent = (tx: Tx, paymentId: string) =>
  tx.payment.update({ where: { id: paymentId }, data: { status: 'CANCELLED', failureReason: EVENT_CANCELLED_REASON } });

/** A paid application's payment belongs to the member it created. */
export const linkToMember = (tx: Tx, paymentId: string, memberId: string) => tx.payment.update({ where: { id: paymentId }, data: { memberId } });

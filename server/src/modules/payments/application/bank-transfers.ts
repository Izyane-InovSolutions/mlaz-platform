import type { Actor } from '../../../shared/actor.js';
import { type Tx, prisma } from '../../../shared/db.js';
import { conflict, notFound } from '../../../shared/errors.js';
import { K } from '../../../shared/money.js';
import { audit } from '../../audit/index.js';
import { type StoredFile, recordDocument } from '../../documents/index.js';
import { type NewPayment, createPayment } from './create-payment.js';
import { loadPayment, paymentView } from './queries.js';
import { settle, settleInTx } from './settle-payment.js';

// Bank transfers and money received outside the online checkout. A transfer is confirmed by Finance against the bank
// statement, after the payer uploads proof of payment.

export async function attachProof(actor: Actor, paymentId: string, bankRef: string, file: StoredFile) {
  return prisma.$transaction(async tx => {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { documents: true, application: true, member: true } });
    if (p.method !== 'BANK_TRANSFER' || p.status !== 'PENDING') throw conflict('Proof of payment can only be added to a pending bank transfer.');
    if (p.documents.length) throw conflict('Proof of payment was already submitted for this payment.');
    await recordDocument(tx, file, { paymentId: p.id, applicationId: p.applicationId, memberId: p.memberId }, actor.label);
    await tx.payment.update({ where: { id: p.id }, data: { bankRef } });
    await audit(tx, actor, p.application?.ref ?? p.member?.number ?? 'Payments', 'Proof of payment submitted', `${p.ref} · ${K(p.amount)} · bank ref ${bankRef}`);
    return loadPayment(tx, p.id);
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

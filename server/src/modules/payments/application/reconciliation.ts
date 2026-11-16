import { config } from '../../../config.js';
import { type Actor, SYSTEM } from '../../../shared/actor.js';
import { prisma } from '../../../shared/db.js';
import { conflict, notFound } from '../../../shared/errors.js';
import { log } from '../../../shared/log.js';
import { K, num } from '../../../shared/money.js';
import { withTimeout } from '../../../shared/timeout.js';
import { audit } from '../../audit/index.js';
import { BANK_PROOF_DAYS, EXPIRED_REASON, GATEWAY_TIMEOUT_MIN, NO_PROOF_REASON, amountMatches } from '../domain/payment-rules.js';
import { providerByName } from '../infrastructure/gateways.js';
import { abandon, settle } from './settle-payment.js';

/**
 * Asks the gateway about every pending online payment and applies final outcomes. The background job runs this under a
 * cluster-wide lease and passes `stillHeld`, checked before each gateway call: if the lease was lost (this run overran
 * it) the run stops rather than overlap the next holder. Settlement is idempotent and locks the payment row anyway, so
 * an overlap could only repeat gateway queries, never apply an outcome twice.
 */
export async function reconcilePending(actor: Actor = SYSTEM, stillHeld: () => Promise<boolean> = async () => true) {
  const pending = await prisma.payment.findMany({ where: { status: 'PENDING', providerRef: { not: null } }, orderBy: { createdAt: 'asc' } });
  let checked = 0, settled = 0;
  for (const p of pending) {
    const provider = providerByName(p.provider);
    if (!provider) continue;
    if (!(await stillHeld())) break;
    checked++;
    const query = provider.query({ providerRef: p.providerRef!, createdAt: p.createdAt, msisdn: p.msisdn });
    const outcome = await withTimeout(query, config.PAYMENT_INITIATE_TIMEOUT_SECONDS * 1000, 'Payment gateway timed out').catch(err => {
      log().error({ event: 'payment.query_failed', paymentRef: p.ref, err }, `Payment ${p.ref}: status query failed`);
      return null;
    });
    if (outcome && outcome.status !== 'PENDING') {
      await settle(p.id, outcome, actor);
      settled++;
    }
  }
  return { checked, settled };
}

/** Reconciliation asked for by a member of staff: the same run, recorded in the audit trail. */
export async function reconcileNow(actor: Actor) {
  const r = await reconcilePending(actor);
  await audit(prisma, actor, 'Payments', 'Reconciled', `${r.checked} pending online payment(s) checked with the gateway · ${r.settled} settled`);
  return r;
}

/** Closes gateway payments that never got an answer, and bank transfers whose proof never arrived. */
export async function expireStale() {
  const gatewayCutoff = new Date(Date.now() - GATEWAY_TIMEOUT_MIN * 60e3);
  const stale = await prisma.payment.findMany({ where: { status: 'PENDING', provider: { notIn: ['bank', 'manual'] }, createdAt: { lt: gatewayCutoff } } });
  for (const p of stale) await settle(p.id, { status: 'FAILED', failureReason: EXPIRED_REASON }, SYSTEM);

  const bankCutoff = new Date(Date.now() - BANK_PROOF_DAYS * 864e5);
  const abandoned = await prisma.payment.findMany({ where: { status: 'PENDING', provider: 'bank', createdAt: { lt: bankCutoff }, documents: { none: {} } } });
  for (const p of abandoned) await prisma.$transaction(tx => abandon(tx, p, NO_PROOF_REASON));
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
  if (event.status === 'SUCCESS' && event.amount !== undefined && !amountMatches(num(p.amount), event.amount)) {
    await audit(prisma, actor, 'Payments', 'Payment amount mismatch', `${p.ref} · expected ${K(p.amount)}, gateway reported ${K(event.amount)} · not applied`);
    throw conflict('Amount does not match the payment.', 'AMOUNT_MISMATCH');
  }
  await settle(p.id, event, actor);
}

import { config } from '../../../config.js';
import { SYSTEM } from '../../../shared/actor.js';
import { prisma } from '../../../shared/db.js';
import { log } from '../../../shared/log.js';
import { num } from '../../../shared/money.js';
import { withTimeout } from '../../../shared/timeout.js';
import { UNREACHABLE_REASON, isGatewayMethod } from '../domain/payment-rules.js';
import { gateway } from '../infrastructure/gateways.js';
import { loadPayment, paymentView } from './queries.js';
import { settle } from './settle-payment.js';

/**
 * Sends a committed gateway payment to the provider. Bank transfers just wait for their proof of payment. Call it after
 * the transaction that created the payment commits: a transaction is never held open across the gateway call.
 *
 * The request is never retried here: our `ref` goes with it, and a gateway adapter that retries must use it as the
 * idempotency key. When the gateway cannot be reached in time the payer is told to try again, but the payment may
 * still have gone through, so: a late answer still records the gateway's reference, and a later success is applied.
 */
export async function initiate(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { lines: true } });
  if (isGatewayMethod(p.method) && p.status === 'PENDING' && !p.providerRef) {
    const request = gateway().initiate({
      ref: p.ref, amount: num(p.amount), method: p.method, msisdn: p.msisdn, payerName: p.payerName,
      description: p.lines.map(l => l.description).join(', '),
    });
    let r: Awaited<typeof request>;
    try {
      r = await withTimeout(request, config.PAYMENT_INITIATE_TIMEOUT_SECONDS * 1000, 'Payment gateway timed out');
    } catch (err) {
      log().error({ event: 'payment.initiate_failed', paymentRef: p.ref, err }, `Payment ${p.ref}: the gateway did not accept the request`);
      await settle(p.id, { status: 'FAILED', failureReason: UNREACHABLE_REASON }, SYSTEM);
      // If the gateway answers after all, keep its reference so its webhook or a reconciliation can still find this payment.
      request.then(late => prisma.payment.updateMany({ where: { id: p.id, providerRef: null }, data: { providerRef: late.providerRef } }))
        .catch(() => {});
      return paymentView(await loadPayment(prisma, p.id));
    }
    // The gateway has the payment from here on. If its reference cannot be saved the error goes to the caller and the
    // payment stays pending (the expiry job closes it), rather than being marked failed while money may move.
    const checkoutUrl = r.checkoutUrl && /^https:\/\//.test(r.checkoutUrl) ? r.checkoutUrl : undefined; // HTTPS checkout pages only
    await prisma.payment.update({ where: { id: p.id }, data: { providerRef: r.providerRef, checkoutUrl, qrPayload: r.qrPayload } });
    if (r.status !== 'PENDING') await settle(p.id, { status: r.status, failureReason: r.failureReason }, SYSTEM);
  }
  return paymentView(await loadPayment(prisma, p.id));
}

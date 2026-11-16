import type { Payment, PaymentPurpose } from '../../../generated/prisma/client.js';
import type { Tx } from '../../../shared/db.js';
import type { FullPayment } from './queries.js';

/**
 * Port: what a payment's outcome means for the thing it pays for. Payments knows how money moves; the module that
 * sells something (applications, membership dues, events) knows what a payment for it does. Each registers a handler
 * for its purpose at startup (platform/modules.ts), so payments depends on none of them.
 *
 * Both callbacks run inside the settlement transaction, with the payment row locked, exactly once per outcome.
 */
export interface SettlementHandler {
  /** The payment succeeded: apply what it paid for (accredit, extend the dues period, confirm the places). */
  paid(tx: Tx, payment: FullPayment): Promise<void>;
  /** The payment will not complete (failed, replaced by a new attempt, or abandoned): release anything held for it. */
  released(tx: Tx, payment: Pick<Payment, 'id' | 'registrationId'>): Promise<void>;
}

const handlers = new Map<PaymentPurpose, SettlementHandler>();

export const registerSettlementHandler = (purpose: PaymentPurpose, handler: SettlementHandler) => { handlers.set(purpose, handler); };

/** Fails loudly when a purpose has no handler: a payment must never settle without applying what it paid for. */
export function settlementHandler(purpose: PaymentPurpose): SettlementHandler {
  const h = handlers.get(purpose);
  if (!h) throw new Error(`No settlement handler for ${purpose} payments: call wireModules() (platform/modules.ts) at startup.`);
  return h;
}

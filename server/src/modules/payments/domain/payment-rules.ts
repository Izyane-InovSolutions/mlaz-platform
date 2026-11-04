// Payment rules: methods, when a payment counts as abandoned, and when a late confirmation must still be honoured.
// The same values as the Prisma enums, kept here so the rules need no database code.

export type PaymentMethod = 'MTN_MOMO' | 'AIRTEL_MONEY' | 'ZAMTEL_KWACHA' | 'IZYANE_QR' | 'CARD' | 'BANK_TRANSFER' | 'CASH';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  MTN_MOMO: 'MTN MoMo', AIRTEL_MONEY: 'Airtel Money', ZAMTEL_KWACHA: 'Zamtel Kwacha', IZYANE_QR: 'iZyane Pay QR',
  CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash',
};
export const ONLINE_METHODS = ['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA', 'IZYANE_QR', 'CARD', 'BANK_TRANSFER'] as const;
const MOBILE_MONEY_METHODS = ['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA'] as const;
const MOBILE_MONEY = new Set<PaymentMethod>(MOBILE_MONEY_METHODS);
export const isMobileMoney = (m: PaymentMethod) => MOBILE_MONEY.has(m);
export const isGatewayMethod = (m: PaymentMethod) => m !== 'BANK_TRANSFER' && m !== 'CASH';

// A gateway payment not settled within this time is marked failed; a later success from the gateway is still honoured.
export const EXPIRED_REASON = 'No confirmation from the payment provider (timed out)';
export const REPLACED_REASON = 'Replaced by a new payment attempt';
// The request may still have reached the gateway (a timeout or a dropped connection), so a later success is honoured.
export const UNREACHABLE_REASON = 'The payment provider could not be reached. Please try again.';
/** Set on pending event payments when the event is cancelled. A late success is still recorded, and flagged for refund. */
export const EVENT_CANCELLED_REASON = 'Event cancelled';
export const NO_PROOF_REASON = 'No proof of payment was submitted';
// Payments the server gave up on although the payer may still approve them at the gateway.
const LATE_SUCCESS_REASONS = new Set([EXPIRED_REASON, REPLACED_REASON, EVENT_CANCELLED_REASON, UNREACHABLE_REASON]);

export const GATEWAY_TIMEOUT_MIN = 30;
export const IN_PROGRESS_MIN = 3;
export const BANK_PROOF_DAYS = 7;

/**
 * A success that arrives after the server gave up on a gateway payment (timed out, replaced, unreachable, event
 * cancelled) is still applied, because the payer's money was taken. Payments recorded by staff are never reopened.
 */
export const isLateSuccess = (p: { provider: string; status: PaymentStatus; failureReason: string | null }, outcome: 'SUCCESS' | 'FAILED') =>
  outcome === 'SUCCESS' && p.provider !== 'manual' && (p.status === 'CANCELLED' || p.status === 'FAILED') && LATE_SUCCESS_REASONS.has(p.failureReason ?? '');

export interface LineInput { type: 'JOINING_FEE' | 'DUES' | 'EVENT_TICKET'; description: string; quantity?: number; unitAmount: number }

/** Line amounts rounded to ngwee. */
export const priceLines = (lines: LineInput[]) => lines.map(l => {
  const quantity = l.quantity ?? 1;
  return { type: l.type, description: l.description, quantity, unitAmount: l.unitAmount, amount: Math.round(quantity * l.unitAmount * 100) / 100 };
});

/** Webhook amounts must match the payment to the ngwee. */
export const amountMatches = (expected: number, reported: number) => Math.abs(reported - expected) <= 0.009;

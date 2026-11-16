// Payments: creating payments, the gateway, settlement (exactly once), bank transfers and reconciliation.
// Public interface for other modules. Modules that sell something register a SettlementHandler for their purpose.
export { METHOD_LABEL, ONLINE_METHODS, UNREACHABLE_REASON } from './domain/payment-rules.js';
export { attachProof, recordOffline } from './application/bank-transfers.js';
export { type Checkout, type OfflinePayment, checkoutSchema, offlineSchema } from './application/checkout.js';
export { cancelForEvent, createPayment, guardPending, linkToMember, lockPayments } from './application/create-payment.js';
export { initiate } from './application/initiate-payment.js';
export { AWAITING_REVIEW, latestPayment, ownedPayment, paymentView, paymentsFor, receipt, viewsOf } from './application/queries.js';
export { expireStale, reconcilePending } from './application/reconciliation.js';
export { settle } from './application/settle-payment.js';
export { type SettlementHandler, registerSettlementHandler } from './application/settlement-handlers.js';

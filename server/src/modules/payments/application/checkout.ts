import { z } from 'zod';
import { s } from '../../../shared/validation.js';
import { ONLINE_METHODS, isMobileMoney } from '../domain/payment-rules.js';

/** Body of every "pay now" endpoint. */
export const checkoutSchema = z.object({
  method: z.enum(ONLINE_METHODS),
  msisdn: s.msisdn.optional(),
}).refine(v => !isMobileMoney(v.method) || v.msisdn, { message: 'Enter the mobile money number to charge', path: ['msisdn'] });
export type Checkout = z.infer<typeof checkoutSchema>;

/** Money received outside the online checkout, recorded by the Secretariat. */
export const offlineSchema = z.object({ method: z.enum(['BANK_TRANSFER', 'CASH']), reference: s.text(80) });
export type OfflinePayment = z.infer<typeof offlineSchema>;

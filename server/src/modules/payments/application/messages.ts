import { K } from '../../../shared/money.js';
import { type Message, SIGNOFF } from '../../communications/index.js';

export const paymentMessages = {
  receipt: (p: { ref: string; payerName: string; amount: unknown; methodLabel: string; lines: { description: string }[] }): Message => ({
    subject: `Receipt ${p.ref}: ${K(p.amount as number)} received`,
    text: `Dear ${p.payerName},\n\nWe received ${K(p.amount as number)} by ${p.methodLabel} for: ${p.lines.map(l => l.description).join('; ')}.\nReceipt number: ${p.ref}. Download it from the member portal.${SIGNOFF}`,
    sms: `MLAZ: ${K(p.amount as number)} received. Receipt ${p.ref}.`,
  }),
  paymentRejected: (p: { ref: string; payerName: string; amount: unknown }, reason: string): Message => ({
    subject: `Bank transfer ${p.ref} could not be confirmed`,
    text: `Dear ${p.payerName},\n\nWe could not confirm your bank transfer of ${K(p.amount as number)} (${p.ref}):\n\n${reason}\n\nPlease check the details and submit the payment again.${SIGNOFF}`,
  }),
};

import { fmtDate } from '../../../shared/dates.js';
import { K } from '../../../shared/money.js';
import { type Message, SIGNOFF } from '../../communications/index.js';

export const eventMessages = {
  registered: (e: { name: string; date: Date; venue: string }, tickets: number): Message => ({
    subject: `Registered: ${e.name}`,
    text: `You are registered for ${e.name} on ${fmtDate(e.date)} at ${e.venue} (${tickets} ticket${tickets === 1 ? '' : 's'}).${SIGNOFF}`,
  }),
  cancelled: (e: { name: string; date: Date }, reason: string, refund: boolean): Message => ({
    subject: `Cancelled: ${e.name}`,
    text: `${e.name} on ${fmtDate(e.date)} has been cancelled. ${reason}${refund ? '\n\nYour ticket payment will be refunded. The Secretariat will contact you.' : ''}${SIGNOFF}`,
  }),
  refunded: (e: { name: string }, amount: unknown, reference: string): Message => ({
    subject: `Refund paid: ${e.name}`,
    text: `Your ticket payment of ${K(amount as number)} for ${e.name} has been refunded (reference ${reference}).\n\nMLAZ Secretariat`,
  }),
};

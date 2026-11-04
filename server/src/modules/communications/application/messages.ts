import { config } from '../../../config.js';

// What every outgoing message shares. Each module writes its own templates (plain text keeps them readable in every
// mail client and easy to localise later) next to the use cases that send them.

export interface Message {
  subject: string;
  text: string;
  sms?: string;
}

export const SIGNOFF = '\n\nMLAZ Secretariat\nMoney Lenders Association of Zambia';
export const memberPortalUrl = () => `${config.PUBLIC_APP_URL}/#/login/member`;
// A reminder that catches up on a missed night can be close to the date itself.
export const expiresIn = (days: number) => (days <= 0 ? 'expires today' : days === 1 ? 'expires tomorrow' : `expires in ${days} days`);

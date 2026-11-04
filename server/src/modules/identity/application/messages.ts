import { type Message, SIGNOFF } from '../../communications/index.js';

export const accountMessages = {
  invite: (name: string, url: string, staff: boolean): Message => ({
    subject: staff ? 'Your MLAZ Secretariat console account' : 'Your MLAZ member portal account',
    text: `Dear ${name},\n\nAn account has been created for you on the MLAZ ${staff ? 'Secretariat console' : 'member portal'}. Set your password here (valid for 7 days): ${url}${SIGNOFF}`,
  }),
  // The code is redacted from the outbox once delivered (redactSecrets), and from log-driver output always.
  signInCode: (name: string, code: string, minutes: number): Message => ({
    subject: 'Your MLAZ sign-in code',
    text: `Dear ${name},\n\nThere have been repeated failed attempts to sign in to your MLAZ account, so signing in from a new device needs a code.\n\nYour sign-in code is ${code}. It is valid for ${minutes} minutes and works once.\n\nIf you did not just try to sign in, someone may know your password: reset it from the sign-in page.${SIGNOFF}`,
  }),
  passwordReset: (name: string, url: string): Message => ({
    subject: 'Reset your MLAZ password',
    text: `Dear ${name},\n\nUse this link to set a new password (valid for 1 hour): ${url}\n\nIf you did not ask for this, ignore this email.${SIGNOFF}`,
  }),
};

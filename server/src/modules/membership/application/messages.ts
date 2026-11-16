import { fmtDate } from '../../../shared/dates.js';
import { K } from '../../../shared/money.js';
import { type Message, SIGNOFF, expiresIn, memberPortalUrl } from '../../communications/index.js';

export const membershipMessages = {
  accredited: (m: { number: string; name: string; contactName: string; validUntil: Date }, setPasswordUrl: string | null): Message => ({
    subject: `Welcome to MLAZ: member ${m.number}`,
    text: `Dear ${m.contactName},\n\nCongratulations. ${m.name} is now an accredited MLAZ member. Member number: ${m.number}. Accreditation valid until ${fmtDate(m.validUntil)}.\n\n`
      + (setPasswordUrl ? `Set a password for the member portal (link valid for 7 days): ${setPasswordUrl}` : `Sign in to the member portal: ${memberPortalUrl()}`)
      + `\n\nYour certificate can be downloaded from the portal, and anyone can verify it by scanning its QR code.${SIGNOFF}`,
    sms: `MLAZ: ${m.name} is now accredited, member no. ${m.number}. Check your email to activate the member portal.`,
  }),
  suspended: (m: { name: string; contactName: string }, reason: string): Message => ({
    subject: 'Your MLAZ membership has been suspended',
    text: `Dear ${m.contactName},\n\nThe membership of ${m.name} has been suspended and its accreditation revoked.\n\nReason: ${reason}\n\nWhile suspended, the business is not listed in the public directory and fails verification.${SIGNOFF}`,
    sms: 'MLAZ: your membership has been suspended. See your email for details.',
  }),
  reinstated: (m: { name: string; contactName: string }): Message => ({
    subject: 'Your MLAZ membership has been reinstated',
    text: `Dear ${m.contactName},\n\nThe membership and accreditation of ${m.name} have been reinstated. A new certificate is available in the member portal: ${memberPortalUrl()}${SIGNOFF}`,
  }),
  lapsed: (m: { name: string; contactName: string }): Message => ({
    subject: 'Your MLAZ membership has lapsed',
    text: `Dear ${m.contactName},\n\nThe membership period of ${m.name} has ended and its accreditation has expired. Pay your annual dues in the member portal to restore it: ${memberPortalUrl()}${SIGNOFF}`,
    sms: 'MLAZ: your membership has lapsed. Pay your dues in the member portal to restore your accreditation.',
  }),
  duesReminder: (m: { name: string; contactName: string; validUntil: Date }, days: number, amount: number): Message => ({
    subject: `MLAZ dues: accreditation ${expiresIn(days)}`,
    text: `Dear ${m.contactName},\n\nThe accreditation of ${m.name} expires on ${fmtDate(m.validUntil)}. Pay your annual dues of ${K(amount)} in the member portal to renew it: ${memberPortalUrl()}${SIGNOFF}`,
    sms: `MLAZ: your accreditation expires ${fmtDate(m.validUntil)}. Pay ${K(amount)} dues in the member portal.`,
  }),
  mofExpiring: (m: { name: string; contactName: string; mofExpiry: Date }, days: number): Message => ({
    subject: `MoF authorization ${expiresIn(days)}`,
    text: `Dear ${m.contactName},\n\nThe Ministry of Finance money-lending authorization for ${m.name} expires on ${fmtDate(m.mofExpiry)}. Upload the renewed authorization in the member portal before then to keep your accreditation: ${memberPortalUrl()}${SIGNOFF}`,
  }),
  mofExpired: (m: { name: string; contactName: string }): Message => ({
    subject: 'MoF authorization expired: accreditation suspended',
    text: `Dear ${m.contactName},\n\nThe Ministry of Finance authorization on file for ${m.name} has expired, so its MLAZ accreditation is suspended. Upload the renewed authorization in the member portal to restore it: ${memberPortalUrl()}${SIGNOFF}`,
    sms: 'MLAZ: your MoF authorization expired and accreditation is suspended. Upload the renewal in the member portal.',
  }),
  renewalVerified: (m: { name: string; contactName: string }, expiry: Date): Message => ({
    subject: 'MoF renewal verified',
    text: `Dear ${m.contactName},\n\nThe renewed Ministry of Finance authorization for ${m.name} has been verified (valid until ${fmtDate(expiry)}).${SIGNOFF}`,
  }),
  renewalRejected: (m: { name: string; contactName: string }, reason: string): Message => ({
    subject: 'MoF renewal could not be verified',
    text: `Dear ${m.contactName},\n\nWe could not verify the authorization you uploaded for ${m.name}:\n\n${reason}\n\nPlease upload a valid authorization in the member portal: ${memberPortalUrl()}${SIGNOFF}`,
  }),
};

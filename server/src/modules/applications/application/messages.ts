import { K } from '../../../shared/money.js';
import { type Message, SIGNOFF } from '../../communications/index.js';

export const applicationMessages = {
  received: (a: { ref: string; contactName: string; businessName: string; hasMof: boolean }, trackUrl: string): Message => ({
    subject: `Application ${a.ref} received`,
    text: `Dear ${a.contactName},\n\nThank you for applying for MLAZ membership for ${a.businessName}. Your reference is ${a.ref}.\n\n`
      + (a.hasMof ? 'The Secretariat will verify your Ministry of Finance authorization within 1-2 working days.' : 'Please upload your Ministry of Finance money-lending authorization so we can start verification.')
      + `\n\nTrack your application: ${trackUrl}${SIGNOFF}`,
    sms: `MLAZ: application ${a.ref} received. Track it at ${trackUrl}`,
  }),
  returned: (a: { ref: string; contactName: string }, reason: string, trackUrl: string): Message => ({
    subject: `Action needed on application ${a.ref}`,
    text: `Dear ${a.contactName},\n\nThe Secretariat returned your application ${a.ref}:\n\n${reason}\n\nUpload a valid authorization here: ${trackUrl}${SIGNOFF}`,
    sms: `MLAZ: application ${a.ref} needs a valid MoF authorization. See your email for details.`,
  }),
  approved: (a: { ref: string; contactName: string }, total: number, trackUrl: string): Message => ({
    subject: `Application ${a.ref} approved: complete payment`,
    text: `Dear ${a.contactName},\n\nYour Ministry of Finance authorization has been verified. Pay the joining fee and first year's dues (${K(total)}) to receive your accreditation certificate.\n\nPay online: ${trackUrl}${SIGNOFF}`,
    sms: `MLAZ: application ${a.ref} approved. Pay ${K(total)} at ${trackUrl}`,
  }),
  rejected: (a: { ref: string; contactName: string }, reason: string): Message => ({
    subject: `Application ${a.ref} not approved`,
    text: `Dear ${a.contactName},\n\nWe are unable to approve application ${a.ref}:\n\n${reason}\n\nContact the Secretariat if you have questions.${SIGNOFF}`,
  }),
  recommendationDeclined: (a: { ref: string; businessName: string }, by: string, reason: string): Message => ({
    subject: `Recommendation declined: ${a.ref}`,
    text: `${by} declined your recommendation for ${a.businessName} (${a.ref}):\n\n${reason}`,
  }),
  trackingLink: (ref: string, trackUrl: string): Message => ({
    subject: `Your MLAZ application ${ref}`,
    text: `Track your application here: ${trackUrl}\n\nMLAZ Secretariat`,
  }),
};

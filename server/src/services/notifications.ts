import type { NotificationChannel } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { type Db, prisma } from '../lib/db.js';
import { fmtDate } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';
import { K } from '../lib/money.js';
import { redactSecrets } from '../lib/tokens.js';
import { mailer, sms } from '../providers/messaging.js';

export interface Message {
  subject: string;
  text: string;
  sms?: string;
}

/**
 * Queues a message in the outbox. Call it with the same transaction as the change it reports, so a message is sent
 * if and only if the change is committed.
 */
export async function notify(db: Db, to: { email?: string | null; phone?: string | null }, msg: Message, broadcastId?: string) {
  const rows: { channel: NotificationChannel; to: string; subject: string; body: string; broadcastId?: string }[] = [];
  if (to.email) rows.push({ channel: 'EMAIL', to: to.email, subject: msg.subject, body: msg.text, broadcastId });
  if (to.phone && msg.sms) rows.push({ channel: 'SMS', to: to.phone, subject: '', body: msg.sms, broadcastId });
  if (rows.length) await db.notification.createMany({ data: rows });
}

const signoff = '\n\nMLAZ Secretariat\nMoney Lenders Association of Zambia';
const portal = () => `${config.PUBLIC_APP_URL}/#/login/member`;

/** Message templates. Plain text keeps them readable in every mail client and easy to localise later. */
export const T = {
  applicationReceived: (a: { ref: string; contactName: string; businessName: string; hasMof: boolean }, trackUrl: string): Message => ({
    subject: `Application ${a.ref} received`,
    text: `Dear ${a.contactName},\n\nThank you for applying for MLAZ membership for ${a.businessName}. Your reference is ${a.ref}.\n\n`
      + (a.hasMof ? 'The Secretariat will verify your Ministry of Finance authorization within 1-2 working days.' : 'Please upload your Ministry of Finance money-lending authorization so we can start verification.')
      + `\n\nTrack your application: ${trackUrl}${signoff}`,
    sms: `MLAZ: application ${a.ref} received. Track it at ${trackUrl}`,
  }),
  applicationReturned: (a: { ref: string; contactName: string }, reason: string, trackUrl: string): Message => ({
    subject: `Action needed on application ${a.ref}`,
    text: `Dear ${a.contactName},\n\nThe Secretariat returned your application ${a.ref}:\n\n${reason}\n\nUpload a valid authorization here: ${trackUrl}${signoff}`,
    sms: `MLAZ: application ${a.ref} needs a valid MoF authorization. See your email for details.`,
  }),
  applicationApproved: (a: { ref: string; contactName: string }, total: number, trackUrl: string): Message => ({
    subject: `Application ${a.ref} approved: complete payment`,
    text: `Dear ${a.contactName},\n\nYour Ministry of Finance authorization has been verified. Pay the joining fee and first year's dues (${K(total)}) to receive your accreditation certificate.\n\nPay online: ${trackUrl}${signoff}`,
    sms: `MLAZ: application ${a.ref} approved. Pay ${K(total)} at ${trackUrl}`,
  }),
  applicationRejected: (a: { ref: string; contactName: string }, reason: string): Message => ({
    subject: `Application ${a.ref} not approved`,
    text: `Dear ${a.contactName},\n\nWe are unable to approve application ${a.ref}:\n\n${reason}\n\nContact the Secretariat if you have questions.${signoff}`,
  }),
  accredited: (m: { number: string; name: string; contactName: string; validUntil: Date }, setPasswordUrl: string | null): Message => ({
    subject: `Welcome to MLAZ: member ${m.number}`,
    text: `Dear ${m.contactName},\n\nCongratulations. ${m.name} is now an accredited MLAZ member. Member number: ${m.number}. Accreditation valid until ${fmtDate(m.validUntil)}.\n\n`
      + (setPasswordUrl ? `Set a password for the member portal (link valid for 7 days): ${setPasswordUrl}` : `Sign in to the member portal: ${portal()}`)
      + `\n\nYour certificate can be downloaded from the portal, and anyone can verify it by scanning its QR code.${signoff}`,
    sms: `MLAZ: ${m.name} is now accredited, member no. ${m.number}. Check your email to activate the member portal.`,
  }),
  receipt: (p: { ref: string; payerName: string; amount: unknown; methodLabel: string; lines: { description: string }[] }): Message => ({
    subject: `Receipt ${p.ref}: ${K(p.amount as number)} received`,
    text: `Dear ${p.payerName},\n\nWe received ${K(p.amount as number)} by ${p.methodLabel} for: ${p.lines.map(l => l.description).join('; ')}.\nReceipt number: ${p.ref}. Download it from the member portal.${signoff}`,
    sms: `MLAZ: ${K(p.amount as number)} received. Receipt ${p.ref}.`,
  }),
  paymentRejected: (p: { ref: string; payerName: string; amount: unknown }, reason: string): Message => ({
    subject: `Bank transfer ${p.ref} could not be confirmed`,
    text: `Dear ${p.payerName},\n\nWe could not confirm your bank transfer of ${K(p.amount as number)} (${p.ref}):\n\n${reason}\n\nPlease check the details and submit the payment again.${signoff}`,
  }),
  suspended: (m: { name: string; contactName: string }, reason: string): Message => ({
    subject: 'Your MLAZ membership has been suspended',
    text: `Dear ${m.contactName},\n\nThe membership of ${m.name} has been suspended and its accreditation revoked.\n\nReason: ${reason}\n\nWhile suspended, the business is not listed in the public directory and fails verification.${signoff}`,
    sms: 'MLAZ: your membership has been suspended. See your email for details.',
  }),
  reinstated: (m: { name: string; contactName: string }): Message => ({
    subject: 'Your MLAZ membership has been reinstated',
    text: `Dear ${m.contactName},\n\nThe membership and accreditation of ${m.name} have been reinstated. A new certificate is available in the member portal: ${portal()}${signoff}`,
  }),
  lapsed: (m: { name: string; contactName: string }): Message => ({
    subject: 'Your MLAZ membership has lapsed',
    text: `Dear ${m.contactName},\n\nThe membership period of ${m.name} has ended and its accreditation has expired. Pay your annual dues in the member portal to restore it: ${portal()}${signoff}`,
    sms: 'MLAZ: your membership has lapsed. Pay your dues in the member portal to restore your accreditation.',
  }),
  duesReminder: (m: { name: string; contactName: string; validUntil: Date }, days: number, amount: number): Message => ({
    subject: `MLAZ dues: accreditation expires in ${days} days`,
    text: `Dear ${m.contactName},\n\nThe accreditation of ${m.name} expires on ${fmtDate(m.validUntil)}. Pay your annual dues of ${K(amount)} in the member portal to renew it: ${portal()}${signoff}`,
    sms: `MLAZ: your accreditation expires ${fmtDate(m.validUntil)}. Pay ${K(amount)} dues in the member portal.`,
  }),
  mofExpiring: (m: { name: string; contactName: string; mofExpiry: Date }, days: number): Message => ({
    subject: `MoF authorization expires in ${days} days`,
    text: `Dear ${m.contactName},\n\nThe Ministry of Finance money-lending authorization for ${m.name} expires on ${fmtDate(m.mofExpiry)}. Upload the renewed authorization in the member portal before then to keep your accreditation: ${portal()}${signoff}`,
  }),
  mofExpired: (m: { name: string; contactName: string }): Message => ({
    subject: 'MoF authorization expired: accreditation suspended',
    text: `Dear ${m.contactName},\n\nThe Ministry of Finance authorization on file for ${m.name} has expired, so its MLAZ accreditation is suspended. Upload the renewed authorization in the member portal to restore it: ${portal()}${signoff}`,
    sms: 'MLAZ: your MoF authorization expired and accreditation is suspended. Upload the renewal in the member portal.',
  }),
  renewalVerified: (m: { name: string; contactName: string }, expiry: Date): Message => ({
    subject: 'MoF renewal verified',
    text: `Dear ${m.contactName},\n\nThe renewed Ministry of Finance authorization for ${m.name} has been verified (valid until ${fmtDate(expiry)}).${signoff}`,
  }),
  renewalRejected: (m: { name: string; contactName: string }, reason: string): Message => ({
    subject: 'MoF renewal could not be verified',
    text: `Dear ${m.contactName},\n\nWe could not verify the authorization you uploaded for ${m.name}:\n\n${reason}\n\nPlease upload a valid authorization in the member portal: ${portal()}${signoff}`,
  }),
  eventRegistered: (e: { name: string; date: Date; venue: string }, tickets: number): Message => ({
    subject: `Registered: ${e.name}`,
    text: `You are registered for ${e.name} on ${fmtDate(e.date)} at ${e.venue} (${tickets} ticket${tickets === 1 ? '' : 's'}).${signoff}`,
  }),
  eventCancelled: (e: { name: string; date: Date }, reason: string, refund: boolean): Message => ({
    subject: `Cancelled: ${e.name}`,
    text: `${e.name} on ${fmtDate(e.date)} has been cancelled. ${reason}${refund ? '\n\nYour ticket payment will be refunded. The Secretariat will contact you.' : ''}${signoff}`,
  }),
  invite: (name: string, url: string, staff: boolean): Message => ({
    subject: staff ? 'Your MLAZ Secretariat console account' : 'Your MLAZ member portal account',
    text: `Dear ${name},\n\nAn account has been created for you on the MLAZ ${staff ? 'Secretariat console' : 'member portal'}. Set your password here (valid for 7 days): ${url}${signoff}`,
  }),
  passwordReset: (name: string, url: string): Message => ({
    subject: 'Reset your MLAZ password',
    text: `Dear ${name},\n\nUse this link to set a new password (valid for 1 hour): ${url}\n\nIf you did not ask for this, ignore this email.${signoff}`,
  }),
};

/** Delivers due messages from the outbox. Rows are claimed with SKIP LOCKED, so several workers never send one twice. */
export async function processOutbox(limit = 25) {
  const claimed = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Notification" WHERE "status" = 'PENDING' AND "sendAfter" <= now()
      ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    // Lease the rows for 5 minutes; if this worker dies mid-send they become due again.
    await tx.notification.updateMany({ where: { id: { in: ids } }, data: { sendAfter: new Date(Date.now() + 5 * 60e3), attempts: { increment: 1 } } });
    return tx.notification.findMany({ where: { id: { in: ids } } });
  });

  for (const n of claimed) {
    try {
      if (n.channel === 'EMAIL') await mailer.send(n.to, n.subject, n.body);
      else await sms.send(n.to, n.body);
      // Once delivered, the stored copy keeps no live links: a database reader can't use someone's set-password link.
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null, body: redactSecrets(n.body) } });
    } catch (e) {
      const lastError = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const giveUp = n.attempts >= 5;
      await prisma.notification.update({
        where: { id: n.id },
        data: giveUp ? { status: 'FAILED', lastError, body: redactSecrets(n.body) } : { lastError, sendAfter: new Date(Date.now() + 2 ** n.attempts * 60e3) },
      });
    }
  }
  return claimed.length;
}

export { redactSecrets };

/* ================= OPERATIONS ================= */

/** Delivery problems for the Secretariat. Message bodies are never returned (they can hold one-time links). */
export async function listNotifications(status: 'FAILED' | 'PENDING') {
  return prisma.notification.findMany({
    where: { status }, orderBy: { createdAt: 'desc' }, take: 200,
    select: { id: true, channel: true, to: true, subject: true, status: true, attempts: true, lastError: true, createdAt: true, sendAfter: true },
  });
}

/** Re-queues a failed message. Messages whose links were already scrubbed cannot be re-sent usefully, so they are refused. */
export async function retryNotification(id: string) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n) throw notFound('Notification');
  if (n.status !== 'FAILED') return false;
  if (n.body.includes('[redacted]')) return false;
  await prisma.notification.update({ where: { id }, data: { status: 'PENDING', attempts: 0, sendAfter: new Date(), lastError: null } });
  return true;
}

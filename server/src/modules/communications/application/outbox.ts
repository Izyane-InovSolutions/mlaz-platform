import type { NotificationChannel } from '../../../generated/prisma/client.js';
import type { Actor } from '../../../shared/actor.js';
import { type Db, prisma } from '../../../shared/db.js';
import { conflict, notFound } from '../../../shared/errors.js';
import { log } from '../../../shared/log.js';
import { redactSecrets } from '../../../shared/tokens.js';
import { audit } from '../../audit/index.js';
import { MAIL_SEND_LIMIT_MS, mailer, sms } from '../infrastructure/messaging.js';
import type { Message } from './messages.js';

/**
 * Queues a message in the outbox. Call it with the same transaction as the change it reports, so a message is sent
 * if and only if the change is committed.
 */
export async function notify(db: Db, to: { email?: string | null; phone?: string | null }, msg: Message, broadcastId?: string) {
  const rows: { channel: NotificationChannel; to: string; subject: string; body: string; broadcastId?: string }[] = [];
  if (to.email) rows.push({ channel: 'EMAIL', to: to.email, subject: msg.subject, body: msg.text, broadcastId });
  // Without an SMS gateway nothing is queued, rather than messages that would look sent but never arrive.
  if (to.phone && msg.sms && sms) rows.push({ channel: 'SMS', to: to.phone, subject: '', body: msg.sms, broadcastId });
  if (rows.length) await db.notification.createMany({ data: rows });
}

// A worker owns the messages it claims for this long; if it dies mid-send they become due again.
const OUTBOX_LEASE_MS = 5 * 60e3;
// Room left before the lease ends for a database round trip or two after the last send.
const OUTBOX_MARGIN_MS = 30e3;
const MAX_ATTEMPTS = 5;
const SMS_OFF = 'SMS is turned off (SMS_DRIVER=none): no SMS gateway is connected';

/**
 * Delivers due messages from the outbox. Rows are claimed with SKIP LOCKED, so several workers never send one twice.
 *
 * Sends are serial and each can take up to MAIL_SEND_LIMIT_MS, so a slow mail server could otherwise keep this worker
 * sending past its 5-minute claim, when another worker would pick the same rows up and send them again. So a message
 * is only started while a full send still fits in the claim (`budgetMs` from claiming); the rest go back to the queue
 * untouched (their attempt is not counted) for the next tick. The same happens when `stop` is aborted (the process is
 * shutting down), so a deploy never waits for a whole batch. Failures follow the retry policy: back off 2, 4, 8 and
 * 16 minutes, and give up after the 5th attempt.
 */
export async function processOutbox(limit = 25, budgetMs = OUTBOX_LEASE_MS - MAIL_SEND_LIMIT_MS - OUTBOX_MARGIN_MS, stop?: AbortSignal) {
  const claimedAt = Date.now();
  const claimed = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Notification" WHERE "status" = 'PENDING' AND "sendAfter" <= now()
      ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    await tx.notification.updateMany({ where: { id: { in: ids } }, data: { sendAfter: new Date(claimedAt + OUTBOX_LEASE_MS), attempts: { increment: 1 } } });
    return tx.notification.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });
  });

  let sent = 0;
  for (const [i, n] of claimed.entries()) {
    if (Date.now() - claimedAt > budgetMs || stop?.aborted) {
      const rest = claimed.slice(i).map(r => r.id);
      await prisma.notification.updateMany({ where: { id: { in: rest }, status: 'PENDING' }, data: { sendAfter: new Date(), attempts: { decrement: 1 } } });
      break;
    }
    try {
      if (n.channel === 'EMAIL') await mailer.send(n.to, n.subject, n.body);
      else if (sms) await sms.send(n.to, n.body);
      else throw new Error(SMS_OFF); // queued before SMS was turned off
      // Once delivered, the stored copy keeps no live links: a database reader can't use someone's set-password link.
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null, body: redactSecrets(n.body) } });
      sent++;
    } catch (e) {
      const lastError = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 500);
      const giveUp = n.attempts >= MAX_ATTEMPTS || lastError === SMS_OFF;
      // The id identifies the message for the Secretariat's delivery list; the recipient and body stay out of the log.
      log().error({ event: giveUp ? 'outbox.gave_up' : 'outbox.send_failed', notificationId: n.id, channel: n.channel, attempt: n.attempts, error: lastError },
        `Notification ${n.id} (${n.channel}) attempt ${n.attempts} failed${giveUp ? ', giving up' : ''}: ${lastError}`);
      await prisma.notification.update({
        where: { id: n.id },
        data: giveUp ? { status: 'FAILED', lastError, body: redactSecrets(n.body) } : { lastError, sendAfter: new Date(Date.now() + 2 ** n.attempts * 60e3) },
      });
    }
  }
  return sent;
}

/* ================= OPERATIONS ================= */

/** Delivery problems for the Secretariat. Message bodies are never returned (they can hold one-time links). */
export async function listNotifications(status: 'FAILED' | 'PENDING') {
  return prisma.notification.findMany({
    where: { status }, orderBy: { createdAt: 'desc' }, take: 200,
    select: { id: true, channel: true, to: true, subject: true, status: true, attempts: true, lastError: true, createdAt: true, sendAfter: true },
  });
}

/** Re-queues a failed message. Messages whose links were already scrubbed cannot be re-sent usefully, so they are refused. */
export async function retryNotification(actor: Actor, id: string) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n) throw notFound('Notification');
  if (n.status !== 'FAILED' || n.body.includes('[redacted]')) throw conflict('This message cannot be re-sent. Send a new invitation or reset link instead.');
  await prisma.$transaction(async tx => {
    await tx.notification.update({ where: { id }, data: { status: 'PENDING', attempts: 0, sendAfter: new Date(), lastError: null } });
    await audit(tx, actor, 'Communications', 'Message re-queued', id);
  });
  return { queued: true };
}

/** Delivery counts per broadcast, in one query. */
export async function deliveryCounts(broadcastIds: string[]) {
  const counts = await prisma.notification.groupBy({ by: ['broadcastId', 'status'], where: { broadcastId: { in: broadcastIds } }, _count: true });
  const out = new Map<string, { pending: number; sent: number; failed: number }>(broadcastIds.map(id => [id, { pending: 0, sent: 0, failed: 0 }]));
  for (const c of counts) {
    const d = c.broadcastId ? out.get(c.broadcastId) : undefined;
    if (d) d[c.status.toLowerCase() as 'pending' | 'sent' | 'failed'] = c._count;
  }
  return out;
}

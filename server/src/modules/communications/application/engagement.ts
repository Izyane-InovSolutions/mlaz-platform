import { z } from 'zod';
import type { Actor } from '../../../shared/actor.js';
import { prisma } from '../../../shared/db.js';
import { notFound } from '../../../shared/errors.js';
import { s } from '../../../shared/validation.js';
import { audit } from '../../audit/index.js';
import { type StoredFile, recordDocument } from '../../documents/index.js';
import { audienceDirectory } from './audiences.js';
import { deliveryCounts } from './outbox.js';

/* ================= ANNOUNCEMENTS ================= */

export const announcementSchema = z.object({ title: s.text(200), body: s.text(5000), tag: s.text(40) });

export const listAnnouncements = (limit = 50) => prisma.announcement.findMany({ orderBy: { publishedAt: 'desc' }, take: limit });

export async function createAnnouncement(actor: Actor, body: unknown) {
  const v = announcementSchema.parse(body);
  return prisma.$transaction(async tx => {
    const a = await tx.announcement.create({ data: { ...v, createdBy: actor.label } });
    await audit(tx, actor, 'Communications', 'Announcement published', v.title);
    return a;
  });
}

export async function deleteAnnouncement(actor: Actor, id: string) {
  await prisma.$transaction(async tx => {
    const a = await tx.announcement.findUnique({ where: { id } });
    if (!a) throw notFound('Announcement');
    await tx.announcement.delete({ where: { id } });
    await audit(tx, actor, 'Communications', 'Announcement removed', a.title);
  });
}

/* ================= BROADCASTS ================= */

export const broadcastSchema = z.object({
  subject: s.text(200),
  body: s.text(5000),
  audience: s.text(60),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'PORTAL'])).min(1, 'Choose at least one channel'),
  tag: z.string().trim().max(40).optional(),
});

export const audiences = () => audienceDirectory().list();

/** Queues the message for every member in the audience and, for the PORTAL channel, publishes it as an announcement. */
export async function sendBroadcast(actor: Actor, body: unknown) {
  const v = broadcastSchema.parse(body);
  const members = await audienceDirectory().recipients(v.audience);
  const smsText = `MLAZ: ${v.subject}. ${v.body}`.slice(0, 300);
  return prisma.$transaction(async tx => {
    const b = await tx.broadcast.create({ data: { subject: v.subject, body: v.body, audience: v.audience, channels: v.channels, recipientCount: members.length, createdBy: actor.label } });
    const rows = members.flatMap(m => [
      ...(v.channels.includes('EMAIL') && m.contactEmail ? [{ channel: 'EMAIL' as const, to: m.contactEmail, subject: v.subject, body: `${v.body}\n\nMLAZ Secretariat`, broadcastId: b.id }] : []),
      ...(v.channels.includes('SMS') && m.contactPhone ? [{ channel: 'SMS' as const, to: m.contactPhone, subject: '', body: smsText, broadcastId: b.id }] : []),
    ]);
    if (rows.length) await tx.notification.createMany({ data: rows });
    if (v.channels.includes('PORTAL')) await tx.announcement.create({ data: { title: v.subject, body: v.body, tag: v.tag || 'Notice', createdBy: actor.label } });
    await audit(tx, actor, 'Communications', 'Broadcast sent', `${v.subject} · ${v.audience} · ${v.channels.join(', ')} · ${members.length} recipient(s)`);
    return b;
  });
}

export async function listBroadcasts() {
  const rows = await prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const delivery = await deliveryCounts(rows.map(b => b.id));
  return rows.map(b => ({ ...b, delivery: delivery.get(b.id)! }));
}

/* ================= RESOURCE LIBRARY ================= */

export const resourceSchema = z.object({ title: s.text(200), category: s.text(80) });

export async function listResources() {
  const rows = await prisma.resource.findMany({ include: { document: { select: { filename: true, mimeType: true, size: true } } }, orderBy: [{ category: 'asc' }, { createdAt: 'desc' }] });
  return rows.map(r => ({ id: r.id, title: r.title, category: r.category, documentId: r.documentId, filename: r.document.filename, mimeType: r.document.mimeType, size: r.document.size, createdAt: r.createdAt }));
}

/** The stored file behind a resource, for download. Resources are member-facing material. */
export async function resourceDocument(id: string) {
  const r = await prisma.resource.findUnique({ where: { id }, include: { document: true } });
  if (!r) throw notFound('Resource');
  return r.document;
}

export async function addResource(actor: Actor, v: z.infer<typeof resourceSchema>, file: StoredFile) {
  return prisma.$transaction(async tx => {
    const doc = await recordDocument(tx, file, {}, actor.label);
    const r = await tx.resource.create({ data: { ...v, documentId: doc.id } });
    await audit(tx, actor, 'Communications', 'Resource added', `${v.category} · ${v.title}`);
    return r;
  });
}

export async function deleteResource(actor: Actor, id: string) {
  await prisma.$transaction(async tx => {
    const r = await tx.resource.findUnique({ where: { id } });
    if (!r) throw notFound('Resource');
    await tx.resource.delete({ where: { id } });
    await audit(tx, actor, 'Communications', 'Resource removed', `${r.category} · ${r.title}`);
  });
}

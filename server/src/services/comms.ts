import { z } from 'zod';
import type { Prisma as P } from '../generated/prisma/client.js';
import { type Actor, audit } from '../lib/audit.js';
import { addDays, today } from '../lib/dates.js';
import { type Db, prisma } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { StoredFile } from '../lib/uploads.js';
import { PROVINCES, s } from '../lib/validate.js';
import { getSetting } from './settings.js';

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

// Audiences: ALL, DUES_DUE (dues payable now or overdue), LAPSED, SUSPENDED, TIER:<name>, PROVINCE:<name>
export async function audienceWhere(db: Db, audience: string): Promise<P.MemberWhereInput> {
  if (audience === 'ALL') return { status: { not: 'SUSPENDED' } };
  if (audience === 'LAPSED') return { status: 'LAPSED' };
  if (audience === 'SUSPENDED') return { status: 'SUSPENDED' };
  if (audience === 'DUES_DUE') {
    const windowDays = await getSetting(db, 'renewalWindowDays');
    return { status: { not: 'SUSPENDED' }, validUntil: { lte: addDays(today(), windowDays) } };
  }
  const [kind, value] = audience.split(':');
  if (kind === 'TIER' && value) return { tierName: value, status: { not: 'SUSPENDED' } };
  if (kind === 'PROVINCE' && (PROVINCES as readonly string[]).includes(value)) return { province: value, status: { not: 'SUSPENDED' } };
  throw badRequest(`Unknown audience ${audience}.`);
}

export async function audiences() {
  const tiers = await prisma.tier.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  const keys = [
    ['ALL', 'All members'], ['DUES_DUE', 'Dues due or overdue'], ['LAPSED', 'Lapsed members'], ['SUSPENDED', 'Suspended members'],
    ...tiers.map(t => [`TIER:${t.name}`, `${t.name} tier`]),
    ...PROVINCES.map(p => [`PROVINCE:${p}`, `${p} Province`]),
  ];
  return Promise.all(keys.map(async ([key, label]) => ({ key, label, count: await prisma.member.count({ where: await audienceWhere(prisma, key) }) })));
}

export const broadcastSchema = z.object({
  subject: s.text(200),
  body: s.text(5000),
  audience: s.text(60),
  channels: z.array(z.enum(['EMAIL', 'SMS', 'PORTAL'])).min(1, 'Choose at least one channel'),
  tag: z.string().trim().max(40).optional(),
});

/** Queues the message for every member in the audience and, for the PORTAL channel, publishes it as an announcement. */
export async function sendBroadcast(actor: Actor, body: unknown) {
  const v = broadcastSchema.parse(body);
  const where = await audienceWhere(prisma, v.audience);
  const members = await prisma.member.findMany({ where, select: { contactEmail: true, contactPhone: true } });
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
  return Promise.all(rows.map(async b => {
    const counts = await prisma.notification.groupBy({ by: ['status'], where: { broadcastId: b.id }, _count: true });
    const delivery = Object.fromEntries(counts.map(c => [c.status, c._count]));
    return { ...b, delivery: { pending: delivery.PENDING ?? 0, sent: delivery.SENT ?? 0, failed: delivery.FAILED ?? 0 } };
  }));
}

/* ================= RESOURCE LIBRARY ================= */

export const resourceSchema = z.object({ title: s.text(200), category: s.text(80) });

export async function listResources() {
  const rows = await prisma.resource.findMany({ include: { document: { select: { filename: true, mimeType: true, size: true } } }, orderBy: [{ category: 'asc' }, { createdAt: 'desc' }] });
  return rows.map(r => ({ id: r.id, title: r.title, category: r.category, documentId: r.documentId, filename: r.document.filename, mimeType: r.document.mimeType, size: r.document.size, createdAt: r.createdAt }));
}

export async function addResource(actor: Actor, v: z.infer<typeof resourceSchema>, file: StoredFile) {
  return prisma.$transaction(async tx => {
    const doc = await tx.document.create({ data: { ...file, uploadedBy: actor.label } });
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

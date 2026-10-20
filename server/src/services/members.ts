import { z } from 'zod';
import type { MemberStatus, Prisma as P } from '../generated/prisma/client.js';
import { type Actor, activity, audit } from '../lib/audit.js';
import { addDays, fmtDate, today } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { PROVINCES, s } from '../lib/validate.js';
import { sendInvite } from './accounts.js';
import { goodStandingWhere } from './dashboard.js';
import { duesInfo, inGoodStanding, memberByNumber, memberSummary, suspend } from './membership.js';
import { T, notify } from './notifications.js';
import { guardPending, paymentView, recordOffline } from './payments.js';
import { getSetting } from './settings.js';
import { toCsv } from './reports.js';

// Secretariat-side member management. The membership rules themselves live in membership.ts.

export const listQuery = s.page.extend({
  q: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'LAPSED', 'SUSPENDED']).optional(),
  tier: z.string().optional(),
  province: z.enum(PROVINCES).optional(),
  filter: z.enum(['all', 'good_standing', 'dues_due', 'mof_expired']).default('all'),
});

async function listWhere(q: z.infer<typeof listQuery>): Promise<P.MemberWhereInput> {
  const and: P.MemberWhereInput[] = [];
  if (q.q) and.push({ OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }, { town: { contains: q.q, mode: 'insensitive' } }, { tpin: q.q }] });
  if (q.status) and.push({ status: q.status as MemberStatus });
  if (q.tier) and.push({ tierName: q.tier });
  if (q.province) and.push({ province: q.province });
  if (q.filter === 'good_standing') and.push(goodStandingWhere());
  if (q.filter === 'dues_due') and.push({ status: { not: 'SUSPENDED' }, validUntil: { lte: addDays(today(), await getSetting(prisma, 'renewalWindowDays')) } });
  if (q.filter === 'mof_expired') and.push({ mofStatus: 'EXPIRED' });
  return { AND: and };
}

export async function list(q: z.infer<typeof listQuery>) {
  const where = await listWhere(q);
  const [rows, total] = await Promise.all([
    prisma.member.findMany({ where, orderBy: { number: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.member.count({ where }),
  ]);
  const windowDays = await getSetting(prisma, 'renewalWindowDays');
  const dueBy = addDays(today(), windowDays);
  return {
    items: rows.map(m => ({
      number: m.number, name: m.name, town: m.town, province: m.province, tier: m.tierName, status: m.status, accreditation: m.accreditation,
      mofStatus: m.mofStatus, validUntil: m.validUntil, goodStanding: inGoodStanding(m), duesDue: m.status !== 'SUSPENDED' && m.validUntil <= dueBy,
      contactName: m.contactName, contactPhone: m.contactPhone,
    })),
    total, page: q.page, pageSize: q.pageSize,
  };
}

export async function exportCsv(q: z.infer<typeof listQuery>) {
  const rows = await prisma.member.findMany({ where: await listWhere(q), orderBy: { number: 'asc' } });
  return toCsv({
    cols: ['Member no.', 'Name', 'Town', 'Province', 'Tier', 'Status', 'MoF', 'Accreditation', 'Valid until', 'Contact', 'Phone', 'Email', 'TPIN', 'PACRA'],
    rows: rows.map(m => [m.number, m.name, m.town, m.province, m.tierName, m.status, m.mofStatus, m.accreditation, fmtDate(m.validUntil), m.contactName, m.contactPhone, m.contactEmail, m.tpin, m.pacra]),
  });
}

export async function detail(number: string) {
  const m = await memberByNumber(prisma, number);
  const [summary, activityLog, payments, certificates, renewals, documents, users, trail] = await Promise.all([
    memberSummary(prisma, m),
    prisma.memberActivity.findMany({ where: { memberId: m.id }, orderBy: { at: 'desc' }, take: 50 }),
    prisma.payment.findMany({ where: { memberId: m.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { lines: true, documents: { select: { id: true } }, application: true, member: true, registration: { include: { event: true } } } }),
    prisma.certificate.findMany({ where: { memberId: m.id }, orderBy: { issuedAt: 'desc' } }),
    prisma.mofRenewal.findMany({ where: { memberId: m.id }, orderBy: { submittedAt: 'desc' }, include: { document: { select: { id: true, filename: true } } } }),
    prisma.document.findMany({ where: { memberId: m.id }, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, filename: true, mimeType: true, superseded: true, createdAt: true } }),
    prisma.user.findMany({ where: { memberId: m.id }, select: { id: true, email: true, name: true, active: true, passwordHash: true, lastLoginAt: true } }),
    prisma.auditLog.findMany({ where: { target: m.number }, orderBy: { at: 'desc' }, take: 100 }),
  ]);
  return {
    ...summary,
    activity: activityLog,
    payments: await Promise.all(payments.map(paymentView)),
    certificates, renewals, documents,
    users: users.map(({ passwordHash, ...u }) => ({ ...u, invitePending: !passwordHash })),
    audit: trail,
  };
}

export const updateSchema = z.object({
  name: s.text(200), town: s.text(100), province: z.enum(PROVINCES), address: z.string().trim().max(300),
  tpin: s.tpin, pacra: z.union([s.pacra, z.literal('')]), tier: s.text(40),
  contactName: s.text(120), contactPhone: s.phone, contactEmail: s.email,
}).partial();

export async function update(actor: Actor, number: string, body: unknown) {
  const v = updateSchema.parse(body);
  const m = await memberByNumber(prisma, number);
  if (v.tier && !(await prisma.tier.findUnique({ where: { name: v.tier } }))) throw badRequest(`Unknown tier ${v.tier}.`);
  const { tier, ...rest } = v;
  const data = { ...rest, ...(tier && { tierName: tier }) };
  const changed = Object.entries(data).filter(([k, val]) => (m as Record<string, unknown>)[k] !== val).map(([k, val]) => `${k}: ${val}`);
  if (!changed.length) return memberSummary(prisma, m);
  return prisma.$transaction(async tx => {
    const updated = await tx.member.update({ where: { id: m.id }, data });
    await activity(tx, m.id, 'profile_updated', 'Details updated by the Secretariat', changed.join(' · '));
    await audit(tx, actor, m.number, 'Member details updated', changed.join(' · '));
    return memberSummary(tx, updated);
  });
}

export async function suspendMember(actor: Actor, number: string, reason: string) {
  await prisma.$transaction(async tx => {
    const m = await memberByNumber(tx, number);
    if (m.status === 'SUSPENDED') throw conflict(`${m.name} is already suspended.`);
    await suspend(tx, m, actor, reason, 'STAFF');
  });
}

export async function sendDuesReminder(actor: Actor, number: string) {
  const m = await memberByNumber(prisma, number);
  const dues = await duesInfo(prisma, m);
  await prisma.$transaction(async tx => {
    await notify(tx, { email: m.contactEmail, phone: m.contactPhone }, T.duesReminder(m, Math.max(0, dues.daysLeft), dues.amount));
    await activity(tx, m.id, 'reminder_sent', 'Reminder sent', `Email and SMS to ${m.contactName}`);
    await audit(tx, actor, m.number, 'Dues reminder sent');
  });
}

/** Records dues paid outside the online checkout (e.g. a transfer seen on the bank statement). */
export async function recordOfflineDues(actor: Actor, number: string, v: { method: 'BANK_TRANSFER' | 'CASH'; reference: string }) {
  const m = await memberByNumber(prisma, number);
  const dues = await duesInfo(prisma, m);
  const p = await prisma.$transaction(async tx => {
    await guardPending(tx, { memberId: m.id, purpose: 'DUES' });
    return recordOffline(tx, actor, {
      purpose: 'DUES', memberId: m.id, payerName: m.name, method: v.method, bankRef: v.reference,
      lines: [{ type: 'DUES', description: `Annual dues (${m.tierName}) · ${fmtDate(dues.periodStart)} to ${fmtDate(dues.periodEnd)}`, unitAmount: dues.amount }],
    });
  });
  return paymentView(p);
}

export async function inviteMemberUser(actor: Actor, number: string, email: string, name: string) {
  const m = await memberByNumber(prisma, number);
  return prisma.$transaction(async tx => {
    const u = await sendInvite(tx, { email, name, role: 'MEMBER', memberId: m.id });
    await audit(tx, actor, m.number, 'Portal user invited', email);
    return { id: u.id, email: u.email, name: u.name };
  });
}

export async function certificatesList(q: { status?: string }) {
  const certs = await prisma.certificate.findMany({
    where: q.status ? { status: q.status as 'VALID' | 'SUPERSEDED' | 'REVOKED' } : { status: 'VALID' },
    orderBy: { issuedAt: 'desc' }, take: 500,
    include: { member: { select: { number: true, name: true, status: true, accreditation: true, mofStatus: true, validUntil: true } } },
  });
  return certs.map(c => ({ serial: c.serial, status: c.status, issuedAt: c.issuedAt, validUntil: c.validUntil, member: { ...c.member, goodStanding: inGoodStanding(c.member) } }));
}

export function assertExists<T>(x: T | null | undefined, what: string): T {
  if (!x) throw notFound(what);
  return x;
}

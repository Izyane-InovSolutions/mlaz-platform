import type { Member, Prisma as P } from '../generated/prisma/client.js';
import { prisma } from '../lib/db.js';
import { goodStandingWhere } from './dashboard.js';
import { inGoodStanding } from './membership.js';

// Public lookups. Only what a borrower or regulator needs: no contact details beyond the town, no financials.

const publicView = (m: Member & { certificates?: { serial: string }[] }) => ({
  number: m.number, name: m.name, town: m.town, province: m.province, tier: m.tierName,
  mofStatus: m.mofStatus, accreditation: m.accreditation, status: m.status, validUntil: m.validUntil,
  goodStanding: inGoodStanding(m), certificateSerial: m.certificates?.[0]?.serial ?? null,
});

const latestCert = { certificates: { where: { status: 'VALID' as const }, orderBy: { issuedAt: 'desc' as const }, take: 1, select: { serial: true } } };

/** Matches a member number, a certificate serial, or (failing those) part of a business name. */
export async function verify(q: string) {
  const query = q.trim();
  if (query.length < 3) return { query, results: [] };
  const byNumber = await prisma.member.findUnique({ where: { number: query.toUpperCase() }, include: latestCert });
  if (byNumber) return { query, results: [publicView(byNumber)] };
  const cert = await prisma.certificate.findUnique({ where: { serial: query.toUpperCase() }, include: { member: { include: latestCert } } });
  if (cert) return { query, results: [{ ...publicView(cert.member), certificateStatus: cert.status }] };
  const byName = await prisma.member.findMany({ where: { name: { contains: query, mode: 'insensitive' } }, include: latestCert, take: 5, orderBy: { name: 'asc' } });
  return { query, results: byName.map(publicView) };
}

export async function directory(q: { q?: string; province?: string; tier?: string; page: number; pageSize: number }) {
  const where: P.MemberWhereInput = { ...goodStandingWhere() };
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { town: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }];
  if (q.province) where.province = q.province;
  if (q.tier) where.tierName = q.tier;
  const [rows, total] = await Promise.all([
    prisma.member.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.member.count({ where }),
  ]);
  return { items: rows.map(m => ({ number: m.number, name: m.name, town: m.town, province: m.province, tier: m.tierName, validUntil: m.validUntil })), total, page: q.page, pageSize: q.pageSize };
}

export async function publicStats() {
  const [accredited, provinces] = await Promise.all([
    prisma.member.count({ where: goodStandingWhere() }),
    prisma.member.groupBy({ by: ['province'], where: goodStandingWhere() }),
  ]);
  return { accreditedMembers: accredited, provinces: provinces.length };
}

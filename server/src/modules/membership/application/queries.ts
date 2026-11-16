import type { Member, Prisma as P } from '../../../generated/prisma/client.js';
import { addDays, daysBetween, today } from '../../../shared/dates.js';
import { type Db, prisma } from '../../../shared/db.js';
import { notFound } from '../../../shared/errors.js';
import { num } from '../../../shared/money.js';
import { getSetting, tierDues } from '../../administration/index.js';
import { inGoodStanding, nextDuesPeriod } from '../domain/standing.js';

// Reads of the member register, shared by the use cases here and offered to other modules.

/** The database form of inGoodStanding (domain/standing.ts). */
export const goodStandingWhere = (): P.MemberWhereInput => ({ status: 'ACTIVE', accreditation: 'ISSUED', mofStatus: 'VALID', validUntil: { gte: today() } });

/** Members whose dues are payable now or overdue (the renewal window has opened), suspended members excepted. */
export async function duesDueWhere(db: Db): Promise<P.MemberWhereInput> {
  const windowDays = await getSetting(db, 'renewalWindowDays');
  return { status: { not: 'SUSPENDED' }, validUntil: { lte: addDays(today(), windowDays) } };
}

export async function memberByNumber(db: Db, number: string) {
  const m = await db.member.findUnique({ where: { number: number.toUpperCase() } });
  if (!m) throw notFound(`Member ${number}`);
  return m;
}

export const memberById = (db: Db, id: string) => db.member.findUniqueOrThrow({ where: { id } });

export const contactOf = (m: Pick<Member, 'contactEmail' | 'contactPhone'>) => ({ email: m.contactEmail, phone: m.contactPhone });

/** The next dues period for a member, and whether it is payable yet. */
export async function duesInfo(db: Db, m: Pick<Member, 'validUntil' | 'tierName'>) {
  const t = today();
  const windowDays = await getSetting(db, 'renewalWindowDays');
  const { periodStart, periodEnd } = nextDuesPeriod(m.validUntil, t);
  const daysLeft = daysBetween(t, m.validUntil);
  return {
    amount: await tierDues(db, m.tierName),
    payable: daysLeft <= windowDays,
    overdue: daysLeft < 0,
    daysLeft,
    periodStart,
    periodEnd,
    opensOn: addDays(m.validUntil, -windowDays),
  };
}
export type DuesInfo = Awaited<ReturnType<typeof duesInfo>>;

// Sequential on purpose: `db` may be a transaction client, which must not run queries concurrently.
export async function memberSummary(db: Db, m: Member) {
  const dues = await duesInfo(db, m);
  const pendingRenewal = await db.mofRenewal.findFirst({ where: { memberId: m.id, status: 'PENDING' }, select: { id: true, mofRef: true, submittedAt: true } });
  const certificate = await db.certificate.findFirst({ where: { memberId: m.id }, orderBy: { issuedAt: 'desc' } });
  return {
    id: m.id, number: m.number, name: m.name, town: m.town, province: m.province, address: m.address, tpin: m.tpin, pacra: m.pacra,
    tier: m.tierName, status: m.status, accreditation: m.accreditation, suspension: m.suspension, suspensionReason: m.suspensionReason,
    mofStatus: m.mofStatus, mofRef: m.mofRef, mofExpiry: m.mofExpiry, validUntil: m.validUntil, joinedAt: m.joinedAt,
    contactName: m.contactName, contactPhone: m.contactPhone, contactEmail: m.contactEmail,
    goodStanding: inGoodStanding(m),
    dues: { ...dues, amount: num(dues.amount) },
    pendingRenewal,
    certificate: certificate && { serial: certificate.serial, status: certificate.status, issuedAt: certificate.issuedAt, validUntil: certificate.validUntil },
  };
}
export type MemberSummary = Awaited<ReturnType<typeof memberSummary>>;

/** The member an application became, with its latest certificate, if it has been accredited. */
export const memberForApplication = (applicationId: string) =>
  prisma.member.findUnique({ where: { applicationId }, include: { certificates: { orderBy: { issuedAt: 'desc' }, take: 1 } } });

/** Members that may be the same business as an applicant: same TPIN or PACRA number, email or name. */
export const possibleDuplicateMembers = (db: Db, a: { id: string; tpin: string; pacra: string; email: string; businessName: string }) =>
  db.member.findMany({ where: { OR: [{ tpin: a.tpin }, { pacra: a.pacra }, { contactEmail: { equals: a.email, mode: 'insensitive' } }, { name: { equals: a.businessName, mode: 'insensitive' } }], NOT: { applicationId: a.id } } });

export const searchMembers = (q: string, take: number) => {
  const like = { contains: q, mode: 'insensitive' as const };
  return prisma.member.findMany({ where: { OR: [{ name: like }, { number: like }, { town: like }] }, take, select: { number: true, name: true, town: true, status: true } });
};

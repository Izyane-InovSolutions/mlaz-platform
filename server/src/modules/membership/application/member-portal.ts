import { z } from 'zod';
import type { Member } from '../../../generated/prisma/client.js';
import type { Actor } from '../../../shared/actor.js';
import { fmtDate } from '../../../shared/dates.js';
import { prisma } from '../../../shared/db.js';
import { badRequest, conflict } from '../../../shared/errors.js';
import { parse, s } from '../../../shared/validation.js';
import { activity, audit } from '../../audit/index.js';
import { inGoodStanding } from '../domain/standing.js';
import { certificatePdf } from '../infrastructure/certificate-pdf.js';
import { type MemberSummary, memberById, memberSummary } from './queries.js';

// The member's own account in the portal.

export const ownProfile = async (memberId: string) => memberSummary(prisma, await memberById(prisma, memberId));

// Members keep their contact details current themselves. The business name, location and registration numbers appear
// on certificates and in the public directory, so only the Secretariat changes those (members-admin.ts).
const OWN_PROFILE_FIELDS = ['address', 'contactName', 'contactPhone', 'contactEmail'];
const ownProfileSchema = z.object({
  address: z.string().trim().max(300), contactName: s.name(120), contactPhone: s.phone, contactEmail: s.email,
}).partial();

export async function updateOwnProfile(actor: Actor, memberId: string, body: unknown) {
  const extra = Object.keys((body ?? {}) as object).filter(k => !OWN_PROFILE_FIELDS.includes(k));
  if (extra.length) throw badRequest('Only contact details and address can be changed here. Ask the Secretariat to change other details.', { fields: extra.map(field => ({ field, message: 'Not editable' })) });
  const v = parse(ownProfileSchema, body);
  const m = await memberById(prisma, memberId);
  const changed = Object.entries(v).filter(([k, val]) => (m as Record<string, unknown>)[k] !== val).map(([k, val]) => `${k}: ${val}`);
  if (!changed.length) return memberSummary(prisma, m);
  const updated = await prisma.$transaction(async tx => {
    const u = await tx.member.update({ where: { id: m.id }, data: v });
    await activity(tx, m.id, 'profile_updated', 'Profile updated', changed.join(' · '));
    await audit(tx, actor, m.number, 'Profile updated by member', changed.join(' · '));
    return u;
  });
  return memberSummary(prisma, updated);
}

/** Banners for the portal's front page: suspension, lapse, dues now payable. */
export function portalAlerts(m: Member, summary: MemberSummary) {
  const alerts: { level: 'danger' | 'warning' | 'info'; code: string; message: string }[] = [];
  if (m.status === 'SUSPENDED') alerts.push({ level: 'danger', code: m.suspension === 'MOF_EXPIRED' ? 'MOF_EXPIRED' : 'SUSPENDED', message: m.suspension === 'MOF_EXPIRED' ? 'Your MoF authorization expired. Upload the renewed authorization to restore your accreditation.' : `Your membership is suspended: ${m.suspensionReason ?? ''}` });
  if (m.status === 'LAPSED') alerts.push({ level: 'danger', code: 'LAPSED', message: 'Your membership has lapsed. Pay your annual dues to restore your accreditation.' });
  if (m.status === 'ACTIVE' && summary.dues.payable) alerts.push({ level: 'warning', code: 'DUES_PAYABLE', message: `Annual dues for ${fmtDate(summary.dues.periodStart)} to ${fmtDate(summary.dues.periodEnd)} are now payable.` });
  return alerts;
}

/** The member's own certificate: only while the accreditation is valid. */
export async function memberCertificate(memberId: string) {
  const m = await memberById(prisma, memberId);
  const cert = await prisma.certificate.findFirst({ where: { memberId: m.id, status: 'VALID' }, orderBy: { issuedAt: 'desc' } });
  if (!cert || !inGoodStanding(m)) throw conflict('Your accreditation is not currently valid, so no certificate can be issued.', 'NOT_ACCREDITED');
  return { filename: `mlaz-certificate-${m.number}.pdf`, pdf: await certificatePdf(m, cert) };
}

/** The certificate of the member an application became, for the applicant's tracking page. */
export async function applicantCertificate(applicationId: string) {
  const m = await prisma.member.findUnique({ where: { applicationId }, include: { certificates: { orderBy: { issuedAt: 'desc' }, take: 1 } } });
  if (!m?.certificates.length) throw conflict('The certificate is issued once payment is confirmed.');
  return { filename: `mlaz-certificate-${m.number}.pdf`, pdf: await certificatePdf(m, m.certificates[0]) };
}

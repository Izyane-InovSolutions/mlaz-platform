import type { Prisma as P } from '../generated/prisma/client.js';
import type { AuthUser } from '../lib/auth.js';
import { addDays, today } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { num } from '../lib/money.js';
import { can } from '../lib/rbac.js';
import { getSetting } from './settings.js';

export const goodStandingWhere = (): P.MemberWhereInput => ({ status: 'ACTIVE', accreditation: 'ISSUED', mofStatus: 'VALID', validUntil: { gte: today() } });

const startOfYear = () => new Date(Date.UTC(today().getUTCFullYear(), 0, 1));
const startOfMonth = () => new Date(Date.UTC(today().getUTCFullYear(), today().getUTCMonth(), 1));

async function duesDueWhere(): Promise<P.MemberWhereInput> {
  const windowDays = await getSetting(prisma, 'renewalWindowDays');
  return { status: { not: 'SUSPENDED' }, validUntil: { lte: addDays(today(), windowDays) } };
}

export async function overview(user: AuthUser) {
  const t = today();
  const [totalMembers, accredited, duesDue, collected, open, mofToVerify, renewals, awaitingApproval, awaitingPayment, lapsed, tiers, regions] = await Promise.all([
    prisma.member.count(),
    prisma.member.count({ where: goodStandingWhere() }),
    prisma.member.count({ where: await duesDueWhere() }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: startOfYear() } }, _sum: { amount: true } }),
    prisma.application.findMany({ where: { stage: { in: ['DETAILS', 'MOF_REVIEW', 'PAYMENT_PENDING'] } }, orderBy: { submittedAt: 'desc' }, include: { recommendedBy: { select: { id: true, name: true } } } }),
    prisma.application.count({ where: { stage: 'MOF_REVIEW', recommendedById: null } }),
    prisma.mofRenewal.findMany({ where: { status: 'PENDING' }, include: { member: { select: { number: true, name: true } } } }),
    prisma.application.count({ where: { stage: 'MOF_REVIEW', recommendedById: { not: null } } }),
    prisma.application.count({ where: { stage: 'PAYMENT_PENDING' } }),
    prisma.member.findMany({ where: { status: { not: 'ACTIVE' } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    prisma.member.groupBy({ by: ['tierName'], _count: true }),
    prisma.member.groupBy({ by: ['province'], _count: true }),
  ]);

  // Cumulative member count at the end of each of the last six months.
  const growth = await Promise.all([5, 4, 3, 2, 1, 0].map(async back => {
    const monthEnd = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - back + 1, 0));
    return { month: monthEnd.toISOString().slice(0, 7), members: await prisma.member.count({ where: { joinedAt: { lte: monthEnd } } }) };
  }));

  const attention: { kind: string; title: string; detail: string; target: string }[] = [];
  if (can(user.role, 'applications:recommend')) {
    open.filter(a => a.stage === 'MOF_REVIEW' && !a.recommendedById).forEach(a => attention.push({ kind: 'mof_to_verify', title: 'MoF authorization to verify', detail: `${a.businessName} · ${a.mofRef ?? ''}`, target: a.ref }));
  }
  if (can(user.role, 'applications:approve')) {
    open.filter(a => a.stage === 'MOF_REVIEW' && a.recommendedBy && a.recommendedBy.id !== user.id).forEach(a => attention.push({ kind: 'awaiting_your_approval', title: 'Recommendation awaiting your approval', detail: `${a.businessName} · recommended by ${a.recommendedBy!.name}`, target: a.ref }));
  }
  if (can(user.role, 'renewals:verify')) {
    renewals.forEach(r => attention.push({ kind: 'renewal_to_verify', title: 'MoF renewal to verify', detail: `${r.member.name} · ${r.mofRef}`, target: r.member.number }));
  }
  if (can(user.role, 'payments:confirm')) {
    const bank = await prisma.payment.findMany({ where: { status: 'PENDING', method: 'BANK_TRANSFER', documents: { some: {} } }, orderBy: { createdAt: 'asc' } });
    bank.forEach(p => attention.push({ kind: 'bank_transfer_to_confirm', title: 'Bank transfer to confirm', detail: `${p.payerName} · ref ${p.bankRef ?? ''}`, target: p.ref }));
  }
  lapsed.forEach(m => attention.push({ kind: `member_${m.status.toLowerCase()}`, title: `${m.name} ${m.status.toLowerCase()}`, detail: m.mofStatus !== 'VALID' ? 'MoF authorization expired' : m.suspensionReason ?? 'Dues and accreditation lapsed', target: m.number }));

  return {
    asAt: t,
    stats: {
      totalMembers, accredited, accreditedShare: totalMembers ? Math.round((accredited / totalMembers) * 1000) / 10 : 0,
      duesDue, collectedYtd: num(collected._sum.amount), openApplications: open.length, mofToVerify: mofToVerify + renewals.length,
      awaitingApproval, awaitingPayment, lapsedOrSuspended: await prisma.member.count({ where: { status: { not: 'ACTIVE' } } }),
    },
    growth,
    tiers: Object.fromEntries(tiers.map(x => [x.tierName, x._count])),
    regions: Object.fromEntries(regions.sort((a, b) => b._count - a._count).map(x => [x.province, x._count])),
    pipeline: open.slice(0, 10).map(a => ({ ref: a.ref, businessName: a.businessName, town: a.town, stage: a.stage, displayStage: a.stage === 'MOF_REVIEW' && a.recommendedById ? 'AWAITING_APPROVAL' : a.stage, submittedAt: a.submittedAt })),
    attention,
  };
}

export async function paymentsSummary() {
  const t = today();
  const [ytd, todays, count, mobile, duesDue, expYtd, expMonth, tiers, tierCounts] = await Promise.all([
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: startOfYear() } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: t } }, _sum: { amount: true }, _count: true }),
    prisma.payment.count({ where: { status: 'SUCCESS', paidAt: { gte: startOfYear() } } }),
    prisma.payment.count({ where: { status: 'SUCCESS', paidAt: { gte: startOfYear() }, method: { in: ['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA'] } } }),
    prisma.member.count({ where: await duesDueWhere() }),
    prisma.expense.aggregate({ where: { deletedAt: null, date: { gte: startOfYear() } }, _sum: { amount: true }, _count: true }),
    prisma.expense.aggregate({ where: { deletedAt: null, date: { gte: startOfMonth() } }, _sum: { amount: true } }),
    prisma.tier.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.member.groupBy({ by: ['tierName'], _count: true }),
  ]);
  return {
    collectedYtd: num(ytd._sum.amount),
    collectedToday: num(todays._sum.amount), transactionsToday: todays._count,
    duesDue,
    mobileMoneyShare: count ? Math.round((mobile / count) * 100) : 0,
    expensesYtd: num(expYtd._sum.amount), expensesCount: expYtd._count, expensesThisMonth: num(expMonth._sum.amount),
    feeSchedule: {
      joiningFee: num(await getSetting(prisma, 'joiningFee')),
      tiers: tiers.map(x => ({ name: x.name, annualDues: num(x.annualDues), members: tierCounts.find(c => c.tierName === x.name)?._count ?? 0 })),
    },
  };
}

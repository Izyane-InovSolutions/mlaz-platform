import { today } from '../../../shared/dates.js';
import { prisma } from '../../../shared/db.js';
import { num } from '../../../shared/money.js';
import { PROVINCES } from '../../../shared/validation.js';
import { activeTiers, fees, getSetting } from '../../administration/index.js';
import { OPEN_STAGES, displayStage } from '../../applications/index.js';
import { timelineFor } from '../../audit/index.js';
import { listAnnouncements } from '../../communications/index.js';
import { MAX_TICKETS, upcomingEvents } from '../../events/index.js';
import { type AuthUser, can } from '../../identity/index.js';
import { duesDueWhere, goodStandingWhere, memberById, memberSummary, pendingRenewals, portalAlerts, searchMembers } from '../../membership/index.js';
import { AWAITING_REVIEW, METHOD_LABEL, ONLINE_METHODS } from '../../payments/index.js';

// Pages that bring several modules together: the staff dashboard and its sidebar counts, the finance summary, the
// console search, the member portal's front page and the website's reference data. They only read.

const startOfYear = () => new Date(Date.UTC(today().getUTCFullYear(), 0, 1));
const startOfMonth = () => new Date(Date.UTC(today().getUTCFullYear(), today().getUTCMonth(), 1));

export async function overview(user: AuthUser) {
  const t = today();
  const [totalMembers, accredited, duesDue, collected, open, mofToVerify, renewals, awaitingApproval, awaitingPayment, lapsed, tiers, regions] = await Promise.all([
    prisma.member.count(),
    prisma.member.count({ where: goodStandingWhere() }),
    prisma.member.count({ where: await duesDueWhere(prisma) }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: startOfYear() } }, _sum: { amount: true } }),
    prisma.application.findMany({ where: { stage: { in: OPEN_STAGES } }, orderBy: { submittedAt: 'desc' }, include: { recommendedBy: { select: { id: true, name: true } } } }),
    prisma.application.count({ where: { stage: 'MOF_REVIEW', recommendedById: null } }),
    pendingRenewals(),
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
    const bank = await prisma.payment.findMany({ where: AWAITING_REVIEW, orderBy: { createdAt: 'asc' } });
    bank.forEach(p => attention.push({ kind: 'bank_transfer_to_confirm', title: 'Bank transfer to confirm', detail: `${p.payerName} · ref ${p.bankRef ?? ''}`, target: p.ref }));
  }
  lapsed.forEach(m => attention.push({ kind: `member_${m.status.toLowerCase()}`, title: `${m.name} ${m.status.toLowerCase()}`, detail: m.mofStatus !== 'VALID' ? 'MoF authorization expired' : m.suspensionReason ?? 'Dues and accreditation lapsed', target: m.number }));

  // Each role sees only the figures it may act on: application pipeline for those who read applications,
  // money for those who read payments.
  const apps = can(user.role, 'applications:read'), money = can(user.role, 'payments:read');
  return {
    asAt: t,
    stats: {
      totalMembers, accredited, accreditedShare: totalMembers ? Math.round((accredited / totalMembers) * 1000) / 10 : 0,
      duesDue, collectedYtd: money ? num(collected._sum.amount) : null,
      openApplications: apps ? open.length : null, mofToVerify: apps ? mofToVerify + renewals.length : renewals.length,
      awaitingApproval: apps ? awaitingApproval : null, awaitingPayment: apps ? awaitingPayment : null,
      lapsedOrSuspended: await prisma.member.count({ where: { status: { not: 'ACTIVE' } } }),
    },
    growth,
    tiers: Object.fromEntries(tiers.map(x => [x.tierName, x._count])),
    regions: Object.fromEntries(regions.sort((a, b) => b._count - a._count).map(x => [x.province, x._count])),
    pipeline: apps ? open.slice(0, 10).map(a => ({ ref: a.ref, businessName: a.businessName, town: a.town, stage: a.stage, displayStage: displayStage(a), submittedAt: a.submittedAt })) : [],
    attention,
  };
}

/** Small counts for the console's sidebar badges, fetched on every page, so kept to cheap count queries. */
export async function navCounts() {
  const [openApplications, mofReview, renewals, awaitingApproval, bankTransfers] = await Promise.all([
    prisma.application.count({ where: { stage: { in: OPEN_STAGES } } }),
    prisma.application.count({ where: { stage: 'MOF_REVIEW', recommendedById: null } }),
    prisma.mofRenewal.count({ where: { status: 'PENDING' } }),
    prisma.application.count({ where: { stage: 'MOF_REVIEW', recommendedById: { not: null } } }),
    prisma.payment.count({ where: AWAITING_REVIEW }),
  ]);
  return { openApplications, mofToVerify: mofReview + renewals, awaitingApproval, bankTransfers };
}

/** Console search box: members and applications by name, number or town, each only for roles that may read them. */
export async function search(user: AuthUser, q: string) {
  const like = { contains: q, mode: 'insensitive' as const };
  const [members, applications] = await Promise.all([
    can(user.role, 'members:read') ? searchMembers(q, 8) : [],
    can(user.role, 'applications:read') ? prisma.application.findMany({ where: { OR: [{ businessName: like }, { ref: like }, { town: like }] }, take: 8, select: { ref: true, businessName: true, town: true, stage: true } }) : [],
  ]);
  return { members, applications };
}

export async function paymentsSummary() {
  const t = today();
  const [ytd, todays, count, mobile, duesDue, expYtd, expMonth, tiers, tierCounts] = await Promise.all([
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: startOfYear() } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: t } }, _sum: { amount: true }, _count: true }),
    prisma.payment.count({ where: { status: 'SUCCESS', paidAt: { gte: startOfYear() } } }),
    prisma.payment.count({ where: { status: 'SUCCESS', paidAt: { gte: startOfYear() }, method: { in: ['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA'] } } }),
    prisma.member.count({ where: await duesDueWhere(prisma) }),
    prisma.expense.aggregate({ where: { deletedAt: null, date: { gte: startOfYear() } }, _sum: { amount: true }, _count: true }),
    prisma.expense.aggregate({ where: { deletedAt: null, date: { gte: startOfMonth() } }, _sum: { amount: true } }),
    activeTiers(prisma),
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

/** The member portal's front page: standing and dues, recent activity, the latest announcements and the next event. */
export async function memberOverview(memberId: string) {
  const m = await memberById(prisma, memberId);
  const [summary, recent, announcements, [nextEvent]] = await Promise.all([
    memberSummary(prisma, m),
    timelineFor(m.id, 10),
    listAnnouncements(3),
    upcomingEvents(1),
  ]);
  return { member: summary, activity: recent, announcements, nextEvent: nextEvent ?? null, alerts: portalAlerts(m, summary) };
}

/** Reference data for the website and its forms: tiers and fees, provinces, payment methods, the bank account. */
export async function siteConfig() {
  return {
    ...(await fees(prisma)),
    provinces: PROVINCES,
    paymentMethods: ONLINE_METHODS.map(code => ({ code, label: METHOD_LABEL[code] })),
    bankAccount: await getSetting(prisma, 'bankAccount'),
    maxEventTickets: MAX_TICKETS,
  };
}

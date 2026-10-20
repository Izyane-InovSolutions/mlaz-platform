import { z } from 'zod';
import type { Prisma as P } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { type Actor, audit } from '../lib/audit.js';
import type { AuthUser } from '../lib/auth.js';
import { dateOnly, today } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { badRequest, notFound, tooMany } from '../lib/errors.js';
import { num } from '../lib/money.js';
import { s } from '../lib/validate.js';
import { GOOD_SCORE, SCORE_MAX, SCORE_MIN, bureau, isGood } from '../providers/bureau.js';

// A member's loan book and credit checks. Every bureau lookup needs the borrower's consent and a purpose, is logged,
// and is capped per member per day.

export const loanSchema = z.object({
  borrowerNrc: s.nrc,
  borrowerName: s.text(120),
  borrowerPhone: s.optionalText(20),
  amount: s.money.refine(n => n > 0, 'Enter an amount above zero'),
  balance: s.money,
  status: z.enum(['CURRENT', 'ARREARS', 'CLOSED']).default('CURRENT'),
  issuedAt: s.date,
});

const loanView = (l: P.LoanGetPayload<object>) => ({
  id: l.id, borrowerNrc: l.borrowerNrc, borrowerName: l.borrowerName, borrowerPhone: l.borrowerPhone, amount: l.amount, balance: l.balance,
  status: l.status, issuedAt: l.issuedAt, score: l.lastScore, scoreRating: l.lastScore == null ? null : isGood(l.lastScore) ? 'GOOD' : 'BAD', lastCheckedAt: l.lastCheckedAt,
});

export async function listLoans(memberId: string, q: { filter?: 'all' | 'good' | 'bad'; q?: string }) {
  const where: P.LoanWhereInput = { memberId };
  if (q.q) where.OR = [{ borrowerName: { contains: q.q, mode: 'insensitive' } }, { borrowerNrc: { contains: q.q } }];
  if (q.filter === 'good') where.lastScore = { gte: GOOD_SCORE };
  if (q.filter === 'bad') where.lastScore = { lt: GOOD_SCORE };
  const [loans, all] = await Promise.all([
    prisma.loan.findMany({ where, orderBy: { issuedAt: 'desc' } }),
    prisma.loan.findMany({ where: { memberId }, select: { lastScore: true, status: true } }),
  ]);
  const scored = all.filter(l => l.lastScore != null).map(l => l.lastScore!);
  return {
    items: loans.map(loanView),
    summary: {
      customers: all.length, openLoans: all.filter(l => l.status !== 'CLOSED').length,
      good: scored.filter(isGood).length, bad: scored.filter(x => !isGood(x)).length, unscored: all.length - scored.length,
      averageScore: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
    },
    scale: { min: SCORE_MIN, max: SCORE_MAX, good: GOOD_SCORE },
  };
}

export async function createLoan(actor: Actor, memberId: string, body: unknown) {
  const v = loanSchema.parse(body);
  if (v.balance > v.amount) throw badRequest('The balance cannot be more than the loan amount.');
  if (dateOnly(v.issuedAt) > today()) throw badRequest('The issue date cannot be in the future.');
  const loan = await prisma.loan.create({ data: { ...v, issuedAt: dateOnly(v.issuedAt), memberId } });
  return loanView(loan);
}

async function ownLoan(memberId: string, id: string) {
  const l = await prisma.loan.findFirst({ where: { id, memberId } });
  if (!l) throw notFound('Loan');
  return l;
}

export async function updateLoan(memberId: string, id: string, body: unknown) {
  const l = await ownLoan(memberId, id);
  const v = loanSchema.partial().parse(body);
  const amount = v.amount ?? num(l.amount), balance = v.balance ?? num(l.balance);
  if (balance > amount) throw badRequest('The balance cannot be more than the loan amount.');
  const data = { ...v, ...(v.issuedAt && { issuedAt: dateOnly(v.issuedAt) }) };
  return loanView(await prisma.loan.update({ where: { id }, data }));
}

export async function deleteLoan(memberId: string, id: string) {
  await ownLoan(memberId, id);
  await prisma.loan.delete({ where: { id } });
}

export const creditCheckSchema = z.object({
  nrc: s.nrc,
  purpose: z.enum(['NEW_LOAN', 'LOAN_REVIEW', 'COLLECTIONS'], { message: 'Choose why you are checking this borrower' }),
  consent: z.literal(true, { message: 'Confirm the borrower has consented to a credit check' }),
});

export async function creditCheck(user: AuthUser, actor: Actor, body: unknown) {
  const v = creditCheckSchema.parse(body);
  const memberId = user.memberId!;
  const used = await prisma.creditCheck.count({ where: { memberId, createdAt: { gte: today() } } });
  if (used >= config.CREDIT_CHECKS_PER_DAY) throw tooMany(`Your daily limit of ${config.CREDIT_CHECKS_PER_DAY} credit checks has been reached.`);
  const record = await bureau.lookup(v.nrc);
  const m = await prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { number: true } });
  await prisma.$transaction(async tx => {
    await tx.creditCheck.create({
      data: { memberId, userId: user.id, nrc: v.nrc, purpose: v.purpose, consent: true, found: !!record, score: record?.score, report: (record ?? undefined) as P.InputJsonValue | undefined },
    });
    if (record) await tx.loan.updateMany({ where: { memberId, borrowerNrc: v.nrc }, data: { lastScore: record.score, lastCheckedAt: new Date() } });
    await audit(tx, actor, m.number, 'Credit check', `NRC ${v.nrc} · ${v.purpose} · ${record ? `score ${record.score}` : 'no bureau record'}`);
  });
  const loans = await prisma.loan.findMany({ where: { memberId, borrowerNrc: v.nrc } });
  return {
    found: !!record,
    report: record && { ...record, rating: isGood(record.score) ? 'GOOD' : 'BAD' },
    yourLoans: loans.map(loanView),
    scale: { min: SCORE_MIN, max: SCORE_MAX, good: GOOD_SCORE },
    checksLeftToday: config.CREDIT_CHECKS_PER_DAY - used - 1,
  };
}

export async function creditCheckHistory(memberId: string) {
  return prisma.creditCheck.findMany({
    where: { memberId }, orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, nrc: true, purpose: true, found: true, score: true, createdAt: true, userId: true },
  });
}

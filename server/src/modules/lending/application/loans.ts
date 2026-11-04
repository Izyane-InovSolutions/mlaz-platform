import { z } from 'zod';
import type { Prisma as P } from '../../../generated/prisma/client.js';
import { dateOnly, today } from '../../../shared/dates.js';
import { prisma } from '../../../shared/db.js';
import { badRequest, notFound } from '../../../shared/errors.js';
import { num } from '../../../shared/money.js';
import { s } from '../../../shared/validation.js';
import { GOOD_SCORE, REUSE_CHECK_DAYS, SCALE, isGood, rating } from '../domain/credit-scores.js';

// A member's own loan book: its borrowers, balances and their latest credit scores.

export const loanSchema = z.object({
  borrowerNrc: s.nrc,
  borrowerName: s.name(120),
  borrowerPhone: s.optionalText(20),
  amount: s.money.refine(n => n > 0, 'Enter an amount above zero'),
  balance: s.money,
  status: z.enum(['CURRENT', 'ARREARS', 'CLOSED']).default('CURRENT'),
  issuedAt: s.date,
});
// For edits: a field left out stays as it is. (zod applies .default() even inside .partial(), which would reset the
// status to CURRENT and blank the phone on every edit.)
const loanUpdateSchema = loanSchema.extend({ borrowerPhone: s.optionalText(20).unwrap(), status: z.enum(['CURRENT', 'ARREARS', 'CLOSED']) }).partial();

export const loanView = (l: P.LoanGetPayload<object>) => ({
  id: l.id, borrowerNrc: l.borrowerNrc, borrowerName: l.borrowerName, borrowerPhone: l.borrowerPhone, amount: l.amount, balance: l.balance,
  status: l.status, issuedAt: l.issuedAt, score: l.lastScore, scoreRating: l.lastScore == null ? null : rating(l.lastScore), lastCheckedAt: l.lastCheckedAt,
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
    scale: SCALE,
  };
}

export async function createLoan(memberId: string, body: unknown) {
  const v = loanSchema.parse(body);
  if (v.balance > v.amount) throw badRequest('The balance cannot be more than the loan amount.');
  if (dateOnly(v.issuedAt) > today()) throw badRequest('The issue date cannot be in the future.');
  // Reuse this member's own recent check of the same borrower, so the score shows without another bureau enquiry.
  const recent = await prisma.creditCheck.findFirst({
    where: { memberId, nrc: v.borrowerNrc, found: true, createdAt: { gte: new Date(Date.now() - REUSE_CHECK_DAYS * 864e5) } },
    orderBy: { createdAt: 'desc' },
  });
  const loan = await prisma.loan.create({
    data: { ...v, issuedAt: dateOnly(v.issuedAt), memberId, ...(recent && { lastScore: recent.score, lastCheckedAt: recent.createdAt }) },
  });
  return loanView(loan);
}

async function ownLoan(memberId: string, id: string) {
  const l = await prisma.loan.findFirst({ where: { id, memberId } });
  if (!l) throw notFound('Loan');
  return l;
}

export async function updateLoan(memberId: string, id: string, body: unknown) {
  const l = await ownLoan(memberId, id);
  const v = loanUpdateSchema.parse(body);
  const amount = v.amount ?? num(l.amount), balance = v.balance ?? num(l.balance);
  if (balance > amount) throw badRequest('The balance cannot be more than the loan amount.');
  const data = { ...v, ...(v.issuedAt && { issuedAt: dateOnly(v.issuedAt) }) };
  return loanView(await prisma.loan.update({ where: { id }, data }));
}

export async function deleteLoan(memberId: string, id: string) {
  await ownLoan(memberId, id);
  await prisma.loan.delete({ where: { id } });
}

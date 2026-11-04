import { z } from 'zod';
import type { Prisma as P } from '../../../generated/prisma/client.js';
import { config } from '../../../config.js';
import type { Actor } from '../../../shared/actor.js';
import { today } from '../../../shared/dates.js';
import { lockKey, prisma } from '../../../shared/db.js';
import { AppError, forbidden, tooMany } from '../../../shared/errors.js';
import { log } from '../../../shared/log.js';
import { withTimeout } from '../../../shared/timeout.js';
import { s } from '../../../shared/validation.js';
import { audit } from '../../audit/index.js';
import type { AuthUser } from '../../identity/index.js';
import { inGoodStanding, memberById } from '../../membership/index.js';
import { SCALE, rating } from '../domain/credit-scores.js';
import { bureau } from '../infrastructure/bureau.js';
import { loanView } from './loans.js';

// Credit checks. Every bureau lookup needs the borrower's consent and a purpose, is logged, and is capped per member
// per day.

export const creditCheckSchema = z.object({
  nrc: s.nrc,
  purpose: z.enum(['NEW_LOAN', 'LOAN_REVIEW', 'COLLECTIONS'], { message: 'Choose why you are checking this borrower' }),
  consent: z.literal(true, { message: 'Confirm the borrower has consented to a credit check' }),
});

// Room for a slow bureau inside the transaction that holds the member's lock (see below): longer than the longest
// BUREAU_TIMEOUT_SECONDS (15).
const CHECK_TIMEOUT_MS = 20_000;
const bureauUnavailable = (message: string) => new AppError(503, 'BUREAU_UNAVAILABLE', message);

export async function creditCheck(user: AuthUser, actor: Actor, body: unknown) {
  const v = creditCheckSchema.parse(body);
  const memberId = user.memberId!;
  // Bureau access is a privilege of accreditation: lapsed or suspended lenders lose it.
  const m = await memberById(prisma, memberId);
  if (!inGoodStanding(m)) throw forbidden('Credit checks are available to members in good standing only.', 'NOT_IN_GOOD_STANDING');
  const source = bureau;
  if (!source) throw bureauUnavailable('Credit checks are not available yet: MLAZ has not connected a credit bureau.');
  // Count, look up and record under a per-member lock, so parallel requests cannot all pass the daily cap before any
  // of them is recorded. This is the one network call made inside a transaction (see docs/architecture.md).
  const { used, record } = await prisma.$transaction(async tx => {
    await lockKey(tx, `credit-checks:${memberId}`);
    const used = await tx.creditCheck.count({ where: { memberId, createdAt: { gte: today() } } });
    if (used >= config.CREDIT_CHECKS_PER_DAY) throw tooMany(`Your daily limit of ${config.CREDIT_CHECKS_PER_DAY} credit checks has been reached.`);
    // A bureau that is down or slow fails this check only: the transaction rolls back, so it is neither recorded nor
    // counted against the daily cap, and the member can try again. Never retried here (see CreditBureau.lookup).
    const record = await withTimeout(source.lookup(v.nrc), config.BUREAU_TIMEOUT_SECONDS * 1000, 'Credit bureau timed out').catch(err => {
      log().error({ event: 'bureau.lookup_failed', memberNumber: m.number, err }, 'credit bureau lookup failed');
      throw bureauUnavailable('The credit bureau is not answering right now. Nothing was recorded; please try again shortly.');
    });
    await tx.creditCheck.create({
      data: { memberId, userId: user.id, nrc: v.nrc, purpose: v.purpose, consent: true, found: !!record, score: record?.score, report: (record ?? undefined) as P.InputJsonValue | undefined },
    });
    if (record) await tx.loan.updateMany({ where: { memberId, borrowerNrc: v.nrc }, data: { lastScore: record.score, lastCheckedAt: new Date() } });
    await audit(tx, actor, m.number, 'Credit check', `NRC ${v.nrc} · ${v.purpose} · ${record ? `score ${record.score}` : 'no bureau record'}`);
    return { used, record };
  }, { timeout: CHECK_TIMEOUT_MS });
  const loans = await prisma.loan.findMany({ where: { memberId, borrowerNrc: v.nrc } });
  return {
    found: !!record,
    // Shown on the report: an invented report must never pass for a real one.
    simulated: source.simulated,
    report: record && { ...record, rating: rating(record.score) },
    yourLoans: loans.map(loanView),
    scale: SCALE,
    checksLeftToday: config.CREDIT_CHECKS_PER_DAY - used - 1,
  };
}

export async function creditCheckHistory(memberId: string) {
  return prisma.creditCheck.findMany({
    where: { memberId }, orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, nrc: true, purpose: true, found: true, score: true, createdAt: true, userId: true },
  });
}

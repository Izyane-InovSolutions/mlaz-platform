import type { Member, Payment, PaymentLine } from '../../../generated/prisma/client.js';
import { type Actor, SYSTEM } from '../../../shared/actor.js';
import { fmtDate } from '../../../shared/dates.js';
import { type Tx, prisma } from '../../../shared/db.js';
import { conflict } from '../../../shared/errors.js';
import { K } from '../../../shared/money.js';
import { activity, audit } from '../../audit/index.js';
import {
  type Checkout, type OfflinePayment, type SettlementHandler, createPayment, guardPending, initiate, latestPayment, paymentView, recordOffline,
} from '../../payments/index.js';
import { inGoodStanding, nextDuesPeriod } from '../domain/standing.js';
import { issueCertificate } from './accreditation.js';
import { type DuesInfo, duesInfo, memberByNumber, memberById } from './queries.js';

/** Records a paid dues period: extends validity, restores a lapsed member and issues a fresh certificate. */
async function applyDues(tx: Tx, payment: Payment & { lines: PaymentLine[] }, m: Member) {
  const { periodStart, periodEnd } = nextDuesPeriod(m.validUntil);
  await tx.duesPayment.create({ data: { memberId: m.id, paymentId: payment.id, periodStart, periodEnd, amount: payment.amount } });
  const restore = m.status === 'LAPSED' && m.mofStatus === 'VALID';
  const updated = await tx.member.update({
    where: { id: m.id },
    data: { validUntil: periodEnd, ...(restore && { status: 'ACTIVE', accreditation: 'ISSUED' }) },
  });
  const detail = `${K(payment.amount)} · ${fmtDate(periodStart)} to ${fmtDate(periodEnd)} · ${payment.ref}`;
  await activity(tx, m.id, 'dues_paid', 'Annual dues paid', detail);
  await audit(tx, SYSTEM, m.number, restore ? 'Dues paid, membership restored' : 'Dues paid', detail);
  if (inGoodStanding(updated)) await issueCertificate(tx, updated);
  return updated;
}

/** What a settled dues payment does. Nothing is held while a dues payment is pending, so nothing is released. */
export const duesSettlement: SettlementHandler = {
  paid: async (tx, p) => { if (p.member) await applyDues(tx, p, p.member); },
  released: async () => {},
};

/** The payment line for a member's next dues period, the same whether paid online or recorded by the Secretariat. */
const duesLine = (m: Pick<Member, 'tierName'>, dues: DuesInfo) =>
  ({ type: 'DUES' as const, description: `Annual dues (${m.tierName}) · ${fmtDate(dues.periodStart)} to ${fmtDate(dues.periodEnd)}`, unitAmount: dues.amount });

/** Records dues paid outside the online checkout (e.g. a transfer seen on the bank statement). */
export async function recordOfflineDues(actor: Actor, number: string, v: OfflinePayment) {
  const m = await memberByNumber(prisma, number);
  const dues = await duesInfo(prisma, m);
  const p = await prisma.$transaction(async tx => {
    await guardPending(tx, { memberId: m.id, purpose: 'DUES' });
    return recordOffline(tx, actor, { purpose: 'DUES', memberId: m.id, payerName: m.name, method: v.method, bankRef: v.reference, lines: [duesLine(m, dues)] });
  });
  return paymentView(p);
}

/** Starts the online payment of the member's next dues period and sends it to the gateway. */
export async function startDuesPayment(actor: Actor, memberId: string, checkout: Checkout) {
  const m = await memberById(prisma, memberId);
  const dues = await duesInfo(prisma, m);
  if (!dues.payable) throw conflict(`Dues for the next period can be paid from ${fmtDate(dues.opensOn)}.`, 'DUES_NOT_PAYABLE');
  if (m.status === 'SUSPENDED') throw conflict('Your membership is suspended. Contact the Secretariat before paying dues.', 'SUSPENDED');
  const p = await prisma.$transaction(async tx => {
    await guardPending(tx, { memberId: m.id, purpose: 'DUES' });
    const payment = await createPayment(tx, {
      purpose: 'DUES', memberId: m.id, payerName: m.name, method: checkout.method, msisdn: checkout.msisdn, lines: [duesLine(m, dues)],
    });
    await audit(tx, actor, m.number, 'Dues payment started', `${payment.ref} · ${checkout.method}`);
    return payment;
  });
  return initiate(p.id); // after commit: never hold a transaction open across the gateway call
}

/** The member's dues page: the next period, what was paid before, and any payment in progress. */
export async function duesOverview(memberId: string) {
  const m = await memberById(prisma, memberId);
  const [info, history, pending] = await Promise.all([
    duesInfo(prisma, m),
    prisma.duesPayment.findMany({ where: { memberId: m.id }, orderBy: { periodStart: 'desc' }, include: { payment: { select: { ref: true, method: true, paidAt: true } } } }),
    latestPayment({ memberId: m.id, purpose: 'DUES' }, ['PENDING']),
  ]);
  return { tier: m.tierName, validUntil: m.validUntil, ...info, history, pendingPayment: pending && (await paymentView(pending)) };
}

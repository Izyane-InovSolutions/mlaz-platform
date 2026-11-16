import type { PaymentStatus, Prisma as P } from '../../../generated/prisma/client.js';
import { type Db, prisma } from '../../../shared/db.js';
import { conflict, notFound } from '../../../shared/errors.js';
import { dateOnly } from '../../../shared/dates.js';
import { getSetting } from '../../administration/index.js';
import { METHOD_LABEL } from '../domain/payment-rules.js';
import { receiptPdf } from '../infrastructure/receipt-pdf.js';

/** Everything a payment view needs. The one definition of the shape (it used to be copied into six places). */
const FULL = { lines: true, documents: { select: { id: true } }, application: true, member: true, registration: { include: { event: true } } } as const;
export type FullPayment = P.PaymentGetPayload<{ include: typeof FULL }>;

export const loadPayment = (db: Db, id: string) => db.payment.findUniqueOrThrow({ where: { id }, include: FULL });

export async function paymentView(p: FullPayment) {
  const awaitingProof = p.method === 'BANK_TRANSFER' && p.status === 'PENDING' && !p.documents.length;
  return {
    ref: p.ref, purpose: p.purpose, status: p.status, method: p.method, methodLabel: METHOD_LABEL[p.method],
    amount: p.amount, payerName: p.payerName,
    lines: p.lines.map(l => ({ type: l.type, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, amount: l.amount })),
    msisdn: p.msisdn, checkoutUrl: p.checkoutUrl, qrPayload: p.qrPayload, bankRef: p.bankRef, failureReason: p.failureReason,
    hasProof: p.documents.length > 0, proofDocumentId: p.documents[0]?.id ?? null, awaitingProof,
    bankAccount: p.method === 'BANK_TRANSFER' && p.status === 'PENDING' ? await getSetting(prisma, 'bankAccount') : undefined,
    applicationRef: p.application?.ref ?? null, memberNumber: p.member?.number ?? null,
    event: p.registration ? { id: p.registration.event.id, name: p.registration.event.name, tickets: p.registration.tickets } : null,
    recordedBy: p.recordedBy, reviewedBy: p.reviewedBy, reviewedAt: p.reviewedAt, createdAt: p.createdAt, paidAt: p.paidAt,
  };
}
export type PaymentView = Awaited<ReturnType<typeof paymentView>>;

export const viewsOf = (ps: FullPayment[]) => Promise.all(ps.map(paymentView));

export async function paymentByRef(ref: string) {
  const p = await prisma.payment.findUnique({ where: { ref: ref.toUpperCase() }, include: FULL });
  if (!p) throw notFound(`Payment ${ref}`);
  return p;
}

/** A payment by reference, only if it belongs to this application or member; anything else is "not found". */
export async function ownedPayment(ref: string, owner: { applicationId: string } | { memberId: string }) {
  const p = await paymentByRef(ref);
  const mine = 'applicationId' in owner ? p.applicationId === owner.applicationId : p.memberId === owner.memberId;
  if (!mine) throw notFound(`Payment ${ref}`);
  return p;
}

/** Payments for one application or member, newest first. */
export const paymentsFor = (where: { applicationId?: string; memberId?: string; purpose?: 'DUES' }, take?: number) =>
  prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, include: FULL, ...(take && { take }) });

/** The newest payment in one of these states, e.g. the one an applicant is in the middle of. */
export const latestPayment = (where: { applicationId?: string; memberId?: string; purpose?: 'DUES' }, statuses: PaymentStatus[]) =>
  prisma.payment.findFirst({ where: { ...where, status: { in: statuses } }, orderBy: { createdAt: 'desc' }, include: FULL });

/** The receipt PDF. Receipts exist only for successful payments; `notYet` is what the caller says otherwise. */
export async function receipt(p: FullPayment, notYet = 'A receipt is issued once the payment is confirmed.') {
  if (p.status !== 'SUCCESS') throw conflict(notYet);
  return { filename: `receipt-${p.ref}.pdf`, pdf: await receiptPdf(await paymentView(p)) };
}

/** Bank transfers whose proof of payment is waiting for Finance to check against the statement. */
export const AWAITING_REVIEW = { status: 'PENDING', method: 'BANK_TRANSFER', documents: { some: {} } } as const satisfies P.PaymentWhereInput;

interface PaymentListQuery {
  status?: PaymentStatus;
  method?: P.PaymentWhereInput['method'] & string;
  purpose?: 'APPLICATION' | 'DUES' | 'EVENT';
  awaitingReview?: 'true' | 'false';
  q?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** The Finance list: filters, a search over reference, payer and bank reference, and a date range on creation. */
export async function listPayments(q: PaymentListQuery) {
  const where: P.PaymentWhereInput = { status: q.status, method: q.method, purpose: q.purpose };
  if (q.awaitingReview === 'true') Object.assign(where, AWAITING_REVIEW);
  if (q.q) where.OR = [{ ref: { contains: q.q, mode: 'insensitive' } }, { payerName: { contains: q.q, mode: 'insensitive' } }, { bankRef: { contains: q.q, mode: 'insensitive' } }];
  if (q.from || q.to) where.createdAt = { ...(q.from && { gte: dateOnly(q.from) }), ...(q.to && { lt: new Date(dateOnly(q.to).getTime() + 864e5) }) };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: FULL }),
    prisma.payment.count({ where }),
  ]);
  return { items: await viewsOf(rows), total, page: q.page, pageSize: q.pageSize };
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma as P } from '../generated/prisma/client.js';
import { dateOnly } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { conflict } from '../lib/errors.js';
import { actorOf, requireStaff } from '../lib/guards.js';
import { audit } from '../lib/audit.js';
import { parse, s } from '../lib/validate.js';
import { paymentsSummary } from '../services/dashboard.js';
import * as expenses from '../services/expenses.js';
import { confirmBankTransfer, paymentByRef, paymentView, reconcilePending, rejectBankTransfer } from '../services/payments.js';
import { receiptPdf } from '../services/pdf.js';
import { sendPdf } from './helpers.js';

const FULL = { lines: true, documents: { select: { id: true } }, application: true, member: true, registration: { include: { event: true } } } as const;

export default async function adminFinanceRoutes(app: FastifyInstance) {
  /* ---------- payments ---------- */
  const listQuery = s.page.extend({
    status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED']).optional(),
    method: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA', 'IZYANE_QR', 'CARD', 'BANK_TRANSFER', 'CASH']).optional(),
    purpose: z.enum(['APPLICATION', 'DUES', 'EVENT']).optional(),
    awaitingReview: z.enum(['true', 'false']).optional(),
    q: z.string().trim().max(100).optional(),
    from: s.date.optional(),
    to: s.date.optional(),
  });

  app.get('/payments', { preHandler: requireStaff('payments:read') }, async req => {
    const q = parse(listQuery, req.query);
    const where: P.PaymentWhereInput = { status: q.status, method: q.method, purpose: q.purpose };
    if (q.awaitingReview === 'true') Object.assign(where, { status: 'PENDING', method: 'BANK_TRANSFER', documents: { some: {} } });
    if (q.q) where.OR = [{ ref: { contains: q.q, mode: 'insensitive' } }, { payerName: { contains: q.q, mode: 'insensitive' } }, { bankRef: { contains: q.q, mode: 'insensitive' } }];
    if (q.from || q.to) where.createdAt = { ...(q.from && { gte: dateOnly(q.from) }), ...(q.to && { lt: new Date(dateOnly(q.to).getTime() + 864e5) }) };
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: FULL }),
      prisma.payment.count({ where }),
    ]);
    return { items: await Promise.all(rows.map(paymentView)), total, page: q.page, pageSize: q.pageSize };
  });

  app.get('/payments/summary', { preHandler: requireStaff('payments:read') }, async () => paymentsSummary());
  app.get('/payments/:ref', { preHandler: requireStaff('payments:read') }, async req => paymentView(await paymentByRef((req.params as { ref: string }).ref)));
  app.get('/payments/:ref/receipt.pdf', { preHandler: requireStaff('payments:read') }, async (req, reply) => {
    const p = await paymentByRef((req.params as { ref: string }).ref);
    if (p.status !== 'SUCCESS') throw conflict('Receipts exist only for successful payments.');
    return sendPdf(reply, `receipt-${p.ref}.pdf`, await receiptPdf(await paymentView(p)));
  });
  app.post('/payments/:ref/confirm', { preHandler: requireStaff('payments:confirm') }, async req => confirmBankTransfer(actorOf(req), (req.params as { ref: string }).ref));
  app.post('/payments/:ref/reject', { preHandler: requireStaff('payments:confirm') }, async req =>
    rejectBankTransfer(actorOf(req), (req.params as { ref: string }).ref, parse(z.object({ reason: s.text(1000) }), req.body).reason));

  /** Asks the gateway about every pending online payment. Bank transfers still need a person to check the statement. */
  app.post('/payments/reconcile', { preHandler: requireStaff('payments:confirm') }, async req => {
    const r = await reconcilePending(actorOf(req));
    await audit(prisma, actorOf(req), 'Payments', 'Reconciled', `${r.checked} pending online payment(s) checked with the gateway · ${r.settled} settled`);
    return r;
  });

  /* ---------- expenses ---------- */
  app.get('/expenses/categories', { preHandler: requireStaff('expenses:read') }, async () => ({ categories: expenses.EXPENSE_CATEGORIES, methods: expenses.EXPENSE_METHODS }));
  app.get('/expenses', { preHandler: requireStaff('expenses:read') }, async req =>
    expenses.list(parse(z.object({ from: s.date.optional(), to: s.date.optional(), category: z.string().optional(), eventId: z.uuid().optional() }), req.query)));
  app.get('/expenses/:ref', { preHandler: requireStaff('expenses:read') }, async req => expenses.get((req.params as { ref: string }).ref));
  app.post('/expenses', { preHandler: requireStaff('expenses:write') }, async (req, reply) => reply.status(201).send(await expenses.create(actorOf(req), req.body)));
  app.delete('/expenses/:ref', { preHandler: requireStaff('expenses:write') }, async (req, reply) => {
    await expenses.remove(actorOf(req), (req.params as { ref: string }).ref);
    return reply.status(204).send();
  });
}

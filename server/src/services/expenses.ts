import { z } from 'zod';
import type { Prisma as P } from '../generated/prisma/client.js';
import { type Actor, audit } from '../lib/audit.js';
import { dateOnly, today } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { nextRef } from '../lib/ids.js';
import { K, num } from '../lib/money.js';
import { s } from '../lib/validate.js';

export const EXPENSE_CATEGORIES = ['Venue booking', 'Catering', 'Printing & materials', 'Travel & transport', 'Speaker & facilitator fees', 'Software & subscriptions', 'Office & admin', 'Marketing', 'Other'] as const;
export const EXPENSE_METHODS = ['Bank transfer', 'Mobile money', 'Card', 'Cash'] as const;

export const expenseSchema = z.object({
  date: s.date,
  category: z.enum(EXPENSE_CATEGORIES),
  description: s.text(300),
  payee: s.text(200),
  amount: s.money.refine(n => n > 0, 'Enter an amount above zero'),
  method: z.enum(EXPENSE_METHODS),
  eventId: z.uuid().optional().nullable(),
});

const view = (x: P.ExpenseGetPayload<{ include: { event: { select: { id: true; name: true } } } }>) => ({
  ref: x.ref, date: x.date, category: x.category, description: x.description, payee: x.payee, amount: x.amount, method: x.method,
  event: x.event, recordedBy: x.recordedBy, createdAt: x.createdAt,
});
const withEvent = { event: { select: { id: true, name: true } } } as const;

export async function list(q: { from?: string; to?: string; category?: string; eventId?: string }) {
  const where: P.ExpenseWhereInput = { deletedAt: null };
  if (q.from || q.to) where.date = { ...(q.from && { gte: dateOnly(q.from) }), ...(q.to && { lte: dateOnly(q.to) }) };
  if (q.category) where.category = q.category;
  if (q.eventId) where.eventId = q.eventId;
  const rows = await prisma.expense.findMany({ where, include: withEvent, orderBy: [{ date: 'desc' }, { ref: 'desc' }] });
  return { items: rows.map(view), total: rows.reduce((a, x) => a + num(x.amount), 0) };
}

export async function get(ref: string) {
  const x = await prisma.expense.findFirst({ where: { ref: ref.toUpperCase(), deletedAt: null }, include: withEvent });
  if (!x) throw notFound(`Expense ${ref}`);
  return view(x);
}

export async function create(actor: Actor, body: unknown) {
  const v = expenseSchema.parse(body);
  if (dateOnly(v.date) > today()) throw badRequest('The payment date cannot be in the future.');
  if (v.eventId && !(await prisma.event.findUnique({ where: { id: v.eventId } }))) throw notFound('Event');
  return prisma.$transaction(async tx => {
    const x = await tx.expense.create({ data: { ...v, date: dateOnly(v.date), ref: await nextRef(tx, 'expense'), recordedBy: actor.label }, include: withEvent });
    await audit(tx, actor, 'Expenses', 'Expense recorded', `${x.ref} · ${x.category} · ${x.payee} · ${K(x.amount)}${x.event ? ` · ${x.event.name}` : ''}`);
    return view(x);
  });
}

/** Soft delete: the row stays for the audit trail but no longer counts in totals. */
export async function remove(actor: Actor, ref: string) {
  await prisma.$transaction(async tx => {
    const x = await tx.expense.findFirst({ where: { ref: ref.toUpperCase(), deletedAt: null } });
    if (!x) throw notFound(`Expense ${ref}`);
    await tx.expense.update({ where: { id: x.id }, data: { deletedAt: new Date(), deletedBy: actor.label } });
    await audit(tx, actor, 'Expenses', 'Expense deleted', `${x.ref} · ${x.category} · ${x.payee} · ${K(x.amount)}`);
  });
}

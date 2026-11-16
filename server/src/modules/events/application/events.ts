import { z } from 'zod';
import type { Event, Prisma as P } from '../../../generated/prisma/client.js';
import type { Actor } from '../../../shared/actor.js';
import { dateOnly, fmtDate, today } from '../../../shared/dates.js';
import { type Db, prisma } from '../../../shared/db.js';
import { badRequest, conflict, notFound } from '../../../shared/errors.js';
import { K, num, sum } from '../../../shared/money.js';
import { s } from '../../../shared/validation.js';
import { audit } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { cancelForEvent } from '../../payments/index.js';
import { eventMessages } from './messages.js';

// Events (AGMs, trainings, webinars) as the Secretariat runs them.

export const MAX_TICKETS = 10;
export const ACTIVE = { in: ['PENDING', 'CONFIRMED'] } as P.EnumRegistrationStatusFilter;

export const eventSchema = z.object({
  name: s.text(200),
  type: z.enum(['TRAINING', 'WEBINAR', 'AGM', 'NETWORKING']),
  date: s.date,
  venue: s.text(200),
  description: s.optionalText(2000),
  capacity: z.coerce.number().int().min(1).max(100_000),
  price: s.money,
});
// For edits: a field left out stays as it is. (zod applies .default() even inside .partial(), which would blank the description.)
const eventUpdateSchema = eventSchema.extend({ description: s.optionalText(2000).unwrap() }).partial();

export async function seatsTaken(db: Db, eventId: string) {
  const r = await db.registration.aggregate({ where: { eventId, status: ACTIVE }, _sum: { tickets: true } });
  return r._sum.tickets ?? 0;
}

async function revenue(db: Db, eventId: string) {
  const r = await db.payment.aggregate({ where: { status: 'SUCCESS', registration: { eventId } }, _sum: { amount: true } });
  return num(r._sum.amount);
}

export const eventView = async (db: Db, e: Event) => eventViewWith(e, await seatsTaken(db, e.id));

export const eventById = async (db: Db, id: string) => {
  const e = await db.event.findUnique({ where: { id } });
  if (!e) throw notFound('Event');
  return e;
};

export const eventExists = async (id: string) => !!(await prisma.event.findUnique({ where: { id }, select: { id: true } }));

/** Published events that have not happened yet, soonest first: the public list, the portal and its front page. */
export const upcomingEvents = (take?: number) =>
  prisma.event.findMany({ where: { status: 'PUBLISHED', date: { gte: today() } }, orderBy: { date: 'asc' }, ...(take && { take }) });

/** Places taken per event, for a list of events, in one query. */
export async function seatsTakenByEvent(db: Db, eventIds: string[]) {
  const rows = await db.registration.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds }, status: ACTIVE }, _sum: { tickets: true } });
  return new Map(rows.map(r => [r.eventId, r._sum.tickets ?? 0]));
}

/** An event's view when the places taken are already known (lists load them for every event at once). */
export function eventViewWith(e: Event, taken: number) {
  return {
    id: e.id, name: e.name, type: e.type, date: e.date, venue: e.venue, description: e.description, capacity: e.capacity,
    price: e.price, status: e.status, cancelReason: e.cancelReason, registered: taken, placesLeft: Math.max(0, e.capacity - taken),
  };
}

/** Lists take three queries whatever their length: the events, their places taken and their ticket revenue. */
export async function listForStaff(includePast: boolean) {
  const events = await prisma.event.findMany({ where: includePast ? {} : { date: { gte: today() } }, orderBy: { date: 'asc' } });
  const ids = events.map(e => e.id);
  const [taken, paid] = await Promise.all([
    seatsTakenByEvent(prisma, ids),
    prisma.registration.findMany({ where: { eventId: { in: ids }, payment: { status: 'SUCCESS' } }, select: { eventId: true, payment: { select: { amount: true } } } }),
  ]);
  const revenueByEvent = new Map<string, number[]>();
  for (const r of paid) revenueByEvent.set(r.eventId, [...(revenueByEvent.get(r.eventId) ?? []), num(r.payment!.amount)]);
  return events.map(e => ({ ...eventViewWith(e, taken.get(e.id) ?? 0), revenue: sum(revenueByEvent.get(e.id) ?? []) }));
}

export async function staffDetail(id: string) {
  const e = await eventById(prisma, id);
  const regs = await prisma.registration.findMany({ where: { eventId: id }, include: { member: { select: { number: true, name: true } }, payment: { select: { ref: true, status: true, method: true } } }, orderBy: { createdAt: 'desc' } });
  return {
    ...(await eventView(prisma, e)), revenue: await revenue(prisma, id),
    registrations: regs.map(r => ({
      id: r.id, member: r.member, tickets: r.tickets, amount: r.amount, status: r.status, refundDue: r.refundDue,
      refundedAt: r.refundedAt, refundRef: r.refundRef, refundedBy: r.refundedBy, payment: r.payment, createdAt: r.createdAt,
    })),
  };
}

export async function create(actor: Actor, body: unknown) {
  const v = eventSchema.parse(body);
  if (dateOnly(v.date) < today()) throw badRequest('The event date is in the past.');
  if (await prisma.event.findUnique({ where: { name: v.name } })) throw conflict('An event with this name already exists.');
  return prisma.$transaction(async tx => {
    const e = await tx.event.create({ data: { ...v, date: dateOnly(v.date) } });
    await audit(tx, actor, 'Events', 'Event created', `${e.name} · ${fmtDate(e.date)} · ${num(e.price) ? `${K(e.price)} per ticket` : 'free'}`);
    return eventView(tx, e);
  });
}

export async function update(actor: Actor, id: string, body: unknown) {
  const v = eventUpdateSchema.parse(body);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`;
    const e = await eventById(tx, id);
    if (e.status === 'CANCELLED') throw conflict('This event has been cancelled.');
    const taken = await seatsTaken(tx, id);
    if (v.capacity !== undefined && v.capacity < taken) throw badRequest(`Capacity cannot be lower than the ${taken} places already taken.`);
    if (v.name && v.name !== e.name && (await tx.event.findUnique({ where: { name: v.name } }))) throw conflict('An event with this name already exists.');
    const data = { ...v, ...(v.date && { date: dateOnly(v.date) }) };
    const updated = await tx.event.update({ where: { id }, data });
    const changes = [
      v.price !== undefined && v.price !== num(e.price) && `price ${K(e.price)} → ${K(v.price)}`,
      v.capacity !== undefined && v.capacity !== e.capacity && `capacity ${e.capacity} → ${v.capacity}`,
      v.date && v.date !== e.date.toISOString().slice(0, 10) && `date ${fmtDate(e.date)} → ${fmtDate(v.date)}`,
      v.venue && v.venue !== e.venue && `venue → ${v.venue}`,
    ].filter(Boolean);
    if (changes.length) await audit(tx, actor, 'Events', 'Event updated', `${e.name} · ${changes.join(' · ')}`);
    return eventView(tx, updated);
  });
}

/** Cancels the event and every registration. Paid registrations are flagged for refund and members are told. */
export async function cancel(actor: Actor, id: string, reason: string) {
  return prisma.$transaction(async tx => {
    const e = await eventById(tx, id);
    if (e.status === 'CANCELLED') throw conflict('This event is already cancelled.');
    const regs = await tx.registration.findMany({ where: { eventId: id, status: ACTIVE }, include: { member: true, payment: true } });
    await tx.event.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
    for (const r of regs) {
      const paid = r.payment?.status === 'SUCCESS';
      await tx.registration.update({ where: { id: r.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), refundDue: paid } });
      if (r.payment?.status === 'PENDING') await cancelForEvent(tx, r.payment.id);
      await notify(tx, { email: r.member.contactEmail }, eventMessages.cancelled(e, reason, paid));
    }
    const refunds = regs.filter(r => r.payment?.status === 'SUCCESS');
    await audit(tx, actor, 'Events', 'Event cancelled', `${e.name} · ${reason} · ${regs.length} registration(s) cancelled${refunds.length ? ` · ${refunds.length} refund(s) due totalling ${K(sum(refunds.map(r => r.amount)))}` : ''}`);
  });
}

/** Records that a refund flagged on a cancelled paid registration has been paid back to the member. */
export async function markRefunded(actor: Actor, registrationId: string, reference: string) {
  return prisma.$transaction(async tx => {
    const r = await tx.registration.findUnique({ where: { id: registrationId }, include: { event: true, member: true } });
    if (!r) throw notFound('Registration');
    if (!r.refundDue || r.refundedAt) throw conflict('This registration has no refund outstanding.');
    await tx.registration.update({ where: { id: r.id }, data: { refundDue: false, refundedAt: new Date(), refundRef: reference, refundedBy: actor.label } });
    await audit(tx, actor, r.member.number, 'Event refund paid', `${r.event.name} · ${K(r.amount)} · ref ${reference}`);
    await notify(tx, { email: r.member.contactEmail }, eventMessages.refunded(r.event, r.amount, reference));
  });
}

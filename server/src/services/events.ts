import { z } from 'zod';
import type { Event, Prisma as P } from '../generated/prisma/client.js';
import { type Actor, activity, audit } from '../lib/audit.js';
import { dateOnly, fmtDate, today } from '../lib/dates.js';
import { type Db, type Tx, prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { K, num, sum } from '../lib/money.js';
import { s } from '../lib/validate.js';
import { T, notify } from './notifications.js';
import { type Checkout, EVENT_CANCELLED_REASON, createPayment, initiate } from './payments.js';

export const MAX_TICKETS = 10;
const ACTIVE = { in: ['PENDING', 'CONFIRMED'] } as P.EnumRegistrationStatusFilter;

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

async function seatsTaken(db: Db, eventId: string) {
  const r = await db.registration.aggregate({ where: { eventId, status: ACTIVE }, _sum: { tickets: true } });
  return r._sum.tickets ?? 0;
}

async function revenue(db: Db, eventId: string) {
  const r = await db.payment.aggregate({ where: { status: 'SUCCESS', registration: { eventId } }, _sum: { amount: true } });
  return num(r._sum.amount);
}

async function eventView(db: Db, e: Event) {
  const taken = await seatsTaken(db, e.id);
  return {
    id: e.id, name: e.name, type: e.type, date: e.date, venue: e.venue, description: e.description, capacity: e.capacity,
    price: e.price, status: e.status, cancelReason: e.cancelReason, registered: taken, placesLeft: Math.max(0, e.capacity - taken),
  };
}

const eventById = async (db: Db, id: string) => {
  const e = await db.event.findUnique({ where: { id } });
  if (!e) throw notFound('Event');
  return e;
};

/* ================= SECRETARIAT ================= */

export async function listForStaff(includePast: boolean) {
  const events = await prisma.event.findMany({ where: includePast ? {} : { date: { gte: today() } }, orderBy: { date: 'asc' } });
  return Promise.all(events.map(async e => ({ ...(await eventView(prisma, e)), revenue: await revenue(prisma, e.id) })));
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
      if (r.payment?.status === 'PENDING') await tx.payment.update({ where: { id: r.payment.id }, data: { status: 'CANCELLED', failureReason: EVENT_CANCELLED_REASON } });
      await notify(tx, { email: r.member.contactEmail }, T.eventCancelled(e, reason, paid));
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
    await notify(tx, { email: r.member.contactEmail }, {
      subject: `Refund paid: ${r.event.name}`,
      text: `Your ticket payment of ${K(r.amount)} for ${r.event.name} has been refunded (reference ${reference}).\n\nMLAZ Secretariat`,
    });
  });
}

/* ================= MEMBER PORTAL ================= */

const myActive = (db: Db, eventId: string, memberId: string) =>
  db.registration.findFirst({ where: { eventId, memberId, status: ACTIVE }, include: { payment: { select: { ref: true, status: true, method: true } } } });

export async function listForMember(memberId: string) {
  const events = await prisma.event.findMany({ where: { status: 'PUBLISHED', date: { gte: today() } }, orderBy: { date: 'asc' } });
  return Promise.all(events.map(async e => ({ ...(await eventView(prisma, e)), myRegistration: await myActive(prisma, e.id, memberId) })));
}

export async function memberDetail(id: string, memberId: string) {
  const e = await eventById(prisma, id);
  return { ...(await eventView(prisma, e)), maxTickets: MAX_TICKETS, myRegistration: await myActive(prisma, id, memberId) };
}

/**
 * Registers a member. The event row is locked so two members can never take the last places at once.
 * Paid events hold the places as PENDING until payment succeeds (released if it fails).
 */
export async function register(actor: Actor, memberId: string, eventId: string, tickets: number, checkout?: Checkout) {
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > MAX_TICKETS) throw badRequest(`Choose between 1 and ${MAX_TICKETS} tickets.`);
  const result = await prisma.$transaction(async (tx: Tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
    const e = await eventById(tx, eventId);
    if (e.status !== 'PUBLISHED' || e.date < today()) throw conflict('Registration for this event is closed.');
    if (await myActive(tx, eventId, memberId)) throw conflict('You are already registered for this event.', 'ALREADY_REGISTERED');
    const left = e.capacity - (await seatsTaken(tx, eventId));
    if (tickets > left) throw conflict(left ? `Only ${left} place(s) left.` : 'This event is fully booked.', 'EVENT_FULL');
    const m = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
    if (m.status !== 'ACTIVE') throw conflict('Event registration is open to active members. Settle your membership first.', 'MEMBERSHIP_NOT_ACTIVE');
    const price = num(e.price);

    if (!price) {
      const r = await tx.registration.create({ data: { eventId, memberId, tickets, amount: 0, status: 'CONFIRMED' } });
      await activity(tx, memberId, 'event_registered', `Registered for ${e.name}`, `${tickets} ticket(s)`);
      await audit(tx, actor, m.number, 'Event registration', `${e.name} · ${tickets} ticket(s)`);
      await notify(tx, { email: m.contactEmail }, T.eventRegistered(e, tickets));
      return { registration: r, paymentId: null };
    }
    if (!checkout) throw badRequest('Choose a payment method for this paid event.');
    const r = await tx.registration.create({ data: { eventId, memberId, tickets, amount: price * tickets, status: 'PENDING' } });
    const p = await createPayment(tx, {
      purpose: 'EVENT', memberId, registrationId: r.id, payerName: m.name, method: checkout.method, msisdn: checkout.msisdn,
      lines: [{ type: 'EVENT_TICKET', description: `Event: ${e.name}`, quantity: tickets, unitAmount: price }],
    });
    await audit(tx, actor, m.number, 'Event registration started', `${e.name} · ${tickets} ticket(s) · ${K(p.amount)} · ${p.ref}`);
    return { registration: r, paymentId: p.id };
  });
  return {
    registrationId: result.registration.id,
    status: result.registration.status,
    payment: result.paymentId ? await initiate(result.paymentId) : null,
  };
}

/** Members can cancel free registrations themselves; paid ones go through the Secretariat (refunds). */
export async function cancelRegistration(actor: Actor, memberId: string, eventId: string) {
  return prisma.$transaction(async tx => {
    const r = await myActive(tx, eventId, memberId);
    if (!r) throw notFound('Registration');
    if (num(r.amount) > 0) throw conflict('To change or cancel a paid registration, contact the Secretariat.');
    const e = await eventById(tx, eventId);
    const m = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
    await tx.registration.update({ where: { id: r.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await audit(tx, actor, m.number, 'Event registration cancelled', e.name);
  });
}

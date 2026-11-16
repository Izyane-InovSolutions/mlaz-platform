import type { Actor } from '../../../shared/actor.js';
import { SYSTEM } from '../../../shared/actor.js';
import { today } from '../../../shared/dates.js';
import { type Db, type Tx, prisma } from '../../../shared/db.js';
import { badRequest, conflict, notFound } from '../../../shared/errors.js';
import { K, num } from '../../../shared/money.js';
import { activity, audit } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { memberById } from '../../membership/index.js';
import { type Checkout, type SettlementHandler, createPayment, initiate } from '../../payments/index.js';
import { ACTIVE, MAX_TICKETS, eventById, eventView, eventViewWith, seatsTaken, seatsTakenByEvent, upcomingEvents } from './events.js';
import { eventMessages } from './messages.js';

// Members registering for events, and what an event payment's outcome does to the places it holds.

const myActive = (db: Db, eventId: string, memberId: string) =>
  db.registration.findFirst({ where: { eventId, memberId, status: ACTIVE }, include: { payment: { select: { ref: true, status: true, method: true } } } });

/** Upcoming events with the member's own registration: three queries whatever the number of events. */
export async function listForMember(memberId: string) {
  const events = await upcomingEvents();
  const ids = events.map(e => e.id);
  const [taken, mine] = await Promise.all([
    seatsTakenByEvent(prisma, ids),
    prisma.registration.findMany({ where: { eventId: { in: ids }, memberId, status: ACTIVE }, include: { payment: { select: { ref: true, status: true, method: true } } } }),
  ]);
  return events.map(e => ({ ...eventViewWith(e, taken.get(e.id) ?? 0), myRegistration: mine.find(r => r.eventId === e.id) ?? null }));
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
    const m = await memberById(tx, memberId);
    if (m.status !== 'ACTIVE') throw conflict('Event registration is open to active members. Settle your membership first.', 'MEMBERSHIP_NOT_ACTIVE');
    const price = num(e.price);

    if (!price) {
      const r = await tx.registration.create({ data: { eventId, memberId, tickets, amount: 0, status: 'CONFIRMED' } });
      await activity(tx, memberId, 'event_registered', `Registered for ${e.name}`, `${tickets} ticket(s)`);
      await audit(tx, actor, m.number, 'Event registration', `${e.name} · ${tickets} ticket(s)`);
      await notify(tx, { email: m.contactEmail }, eventMessages.registered(e, tickets));
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
    const m = await memberById(tx, memberId);
    await tx.registration.update({ where: { id: r.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await audit(tx, actor, m.number, 'Event registration cancelled', e.name);
  });
}

/**
 * What an event payment's outcome does. Success confirms the places it held; a late success for places already released
 * is honoured only while the event still has room, otherwise flagged for refund. A payment that will not complete
 * releases its places.
 */
export const eventSettlement: SettlementHandler = {
  async paid(tx, p) {
    const r = p.registration;
    if (!r || r.status === 'CONFIRMED') return;
    if (r.status === 'CANCELLED') {
      // Late payment for places that were released: honour it only if the event still has room.
      const taken = await tx.registration.aggregate({ where: { eventId: r.eventId, status: ACTIVE }, _sum: { tickets: true } });
      if (r.event.status !== 'PUBLISHED' || (taken._sum.tickets ?? 0) + r.tickets > r.event.capacity) {
        await tx.registration.update({ where: { id: r.id }, data: { refundDue: true } });
        await audit(tx, SYSTEM, 'Events', 'Refund due', `${p.ref} arrived after the places for ${r.event.name} were released`);
        return;
      }
    }
    await tx.registration.update({ where: { id: r.id }, data: { status: 'CONFIRMED', cancelledAt: null } });
    await activity(tx, r.memberId, 'event_registered', `Registered for ${r.event.name}`, `${r.tickets} ticket(s) · ${K(p.amount)} · ${p.ref}`);
    const m = await memberById(tx, r.memberId);
    await notify(tx, { email: m.contactEmail }, eventMessages.registered(r.event, r.tickets));
  },
  async released(tx, p) {
    if (p.registrationId) await tx.registration.updateMany({ where: { id: p.registrationId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  },
};

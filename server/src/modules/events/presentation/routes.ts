import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { params } from '../../../shared/http.js';
import { parse, s } from '../../../shared/validation.js';
import { actorOf, memberIdOf, requireStaff } from '../../identity/http.js';
import { checkoutSchema } from '../../payments/index.js';
import * as events from '../application/events.js';
import { cancelRegistration, listForMember, memberDetail, register } from '../application/registrations.js';

export async function eventsAdminRoutes(app: FastifyInstance) {
  app.get('/events', { preHandler: requireStaff('events:read') }, async req =>
    events.listForStaff(parse(z.object({ past: z.enum(['true', 'false']).default('false') }), req.query).past === 'true'));
  app.get('/events/:id', { preHandler: requireStaff('events:read') }, async req => events.staffDetail(params(req, 'id').id));
  app.post('/events', { preHandler: requireStaff('events:write') }, async (req, reply) => reply.status(201).send(await events.create(actorOf(req), req.body)));
  app.patch('/events/:id', { preHandler: requireStaff('events:write') }, async req => events.update(actorOf(req), params(req, 'id').id, req.body));
  app.post('/events/registrations/:id/refund', { preHandler: requireStaff('payments:record') }, async (req, reply) => {
    await events.markRefunded(actorOf(req), params(req, 'id').id, parse(z.object({ reference: s.line(80) }), req.body).reference);
    return reply.status(204).send();
  });
  app.post('/events/:id/cancel', { preHandler: requireStaff('events:write') }, async (req, reply) => {
    await events.cancel(actorOf(req), params(req, 'id').id, parse(z.object({ reason: s.text(1000) }), req.body).reason);
    return reply.status(204).send();
  });
}

export async function eventsPortalRoutes(app: FastifyInstance) {
  app.get('/events', async req => listForMember(memberIdOf(req)));
  app.get('/events/:id', async req => memberDetail(params(req, 'id').id, memberIdOf(req)));
  app.post('/events/:id/registrations', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const v = parse(z.object({ tickets: z.coerce.number().int() }), body);
    const checkout = body.method ? parse(checkoutSchema, body) : undefined;
    return reply.status(201).send(await register(actorOf(req), memberIdOf(req), params(req, 'id').id, v.tickets, checkout));
  });
  app.delete('/events/:id/registration', async (req, reply) => {
    await cancelRegistration(actorOf(req), memberIdOf(req), params(req, 'id').id);
    return reply.status(204).send();
  });
}

export async function eventsPublicRoutes(app: FastifyInstance) {
  app.get('/events', async () => (await events.upcomingEvents()).map(e => ({ id: e.id, name: e.name, type: e.type, date: e.date, venue: e.venue, price: e.price })));
}

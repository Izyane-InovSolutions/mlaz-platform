import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { actorOf, requireStaff } from '../lib/guards.js';
import { sendDocument } from './helpers.js';
import { readMultipart, requireFile, storeFile } from '../lib/uploads.js';
import { parse, s } from '../lib/validate.js';
import * as comms from '../services/comms.js';
import * as events from '../services/events.js';

type Id = { id: string };

export default async function adminEngageRoutes(app: FastifyInstance) {
  /* ---------- events ---------- */
  app.get('/events', { preHandler: requireStaff('events:read') }, async req =>
    events.listForStaff(parse(z.object({ past: z.enum(['true', 'false']).default('false') }), req.query).past === 'true'));
  app.get('/events/:id', { preHandler: requireStaff('events:read') }, async req => events.staffDetail((req.params as Id).id));
  app.post('/events', { preHandler: requireStaff('events:write') }, async (req, reply) => reply.status(201).send(await events.create(actorOf(req), req.body)));
  app.patch('/events/:id', { preHandler: requireStaff('events:write') }, async req => events.update(actorOf(req), (req.params as Id).id, req.body));
  app.post('/events/registrations/:id/refund', { preHandler: requireStaff('payments:record') }, async (req, reply) => {
    await events.markRefunded(actorOf(req), (req.params as Id).id, parse(z.object({ reference: s.line(80) }), req.body).reference);
    return reply.status(204).send();
  });
  app.post('/events/:id/cancel', { preHandler: requireStaff('events:write') }, async (req, reply) => {
    await events.cancel(actorOf(req), (req.params as Id).id, parse(z.object({ reason: s.text(1000) }), req.body).reason);
    return reply.status(204).send();
  });

  /* ---------- announcements & broadcasts ---------- */
  app.get('/announcements', { preHandler: requireStaff() }, async () => comms.listAnnouncements(100));
  app.post('/announcements', { preHandler: requireStaff('comms:write') }, async (req, reply) => reply.status(201).send(await comms.createAnnouncement(actorOf(req), req.body)));
  app.delete('/announcements/:id', { preHandler: requireStaff('comms:write') }, async (req, reply) => {
    await comms.deleteAnnouncement(actorOf(req), (req.params as Id).id);
    return reply.status(204).send();
  });

  app.get('/broadcasts', { preHandler: requireStaff() }, async () => comms.listBroadcasts());
  app.get('/broadcasts/audiences', { preHandler: requireStaff('comms:write') }, async () => comms.audiences());
  app.post('/broadcasts', { preHandler: requireStaff('comms:write') }, async (req, reply) => reply.status(201).send(await comms.sendBroadcast(actorOf(req), req.body)));

  /* ---------- resource library ---------- */
  app.get('/resources', { preHandler: requireStaff() }, async () => comms.listResources());
  // Resources are member-facing material, so any staff role may download them (unlike application documents).
  app.get('/resources/:id/download', { preHandler: requireStaff() }, async (req, reply) => {
    const r = await prisma.resource.findUnique({ where: { id: (req.params as Id).id }, include: { document: true } });
    if (!r) throw notFound('Resource');
    return sendDocument(reply, r.document);
  });
  app.post('/resources', { preHandler: requireStaff('comms:write') }, async (req, reply) => {
    const { fields, files } = await readMultipart(req);
    const v = parse(comms.resourceSchema, fields);
    const stored = await storeFile(requireFile(files, 'file', 'document'), 'RESOURCE');
    return reply.status(201).send(await comms.addResource(actorOf(req), v, stored));
  });
  app.delete('/resources/:id', { preHandler: requireStaff('comms:write') }, async (req, reply) => {
    await comms.deleteResource(actorOf(req), (req.params as Id).id);
    return reply.status(204).send();
  });
}

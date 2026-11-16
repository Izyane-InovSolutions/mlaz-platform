import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { params, rateLimit } from '../../../shared/http.js';
import { parse } from '../../../shared/validation.js';
import { commitFiles, requireFile, storeFile } from '../../documents/index.js';
import { readMultipart, sendDocument } from '../../documents/http.js';
import { actorOf, requireStaff } from '../../identity/http.js';
import * as comms from '../application/engagement.js';
import { listNotifications, retryNotification } from '../application/outbox.js';

export async function communicationsAdminRoutes(app: FastifyInstance) {
  /* ---------- announcements & broadcasts ---------- */
  app.get('/announcements', { preHandler: requireStaff() }, async () => comms.listAnnouncements(100));
  app.post('/announcements', { preHandler: requireStaff('comms:write') }, async (req, reply) => reply.status(201).send(await comms.createAnnouncement(actorOf(req), req.body)));
  app.delete('/announcements/:id', { preHandler: requireStaff('comms:write') }, async (req, reply) => {
    await comms.deleteAnnouncement(actorOf(req), params(req, 'id').id);
    return reply.status(204).send();
  });

  app.get('/broadcasts', { preHandler: requireStaff() }, async () => comms.listBroadcasts());
  app.get('/broadcasts/audiences', { preHandler: requireStaff('comms:write') }, async () => comms.audiences());
  app.post('/broadcasts', { preHandler: requireStaff('comms:write') }, async (req, reply) => reply.status(201).send(await comms.sendBroadcast(actorOf(req), req.body)));

  /* ---------- resource library ---------- */
  app.get('/resources', { preHandler: requireStaff() }, async () => comms.listResources());
  // Resources are member-facing material, so any staff role may download them (unlike application documents).
  app.get('/resources/:id/download', { preHandler: requireStaff() }, async (req, reply) => sendDocument(reply, await comms.resourceDocument(params(req, 'id').id)));
  app.post('/resources', { preHandler: requireStaff('comms:write'), ...rateLimit(30, '1 hour') }, async (req, reply) => {
    const { fields, files } = await readMultipart(req);
    const v = parse(comms.resourceSchema, fields);
    const stored = await storeFile(requireFile(files, 'file', 'document'), 'RESOURCE');
    return reply.status(201).send(await commitFiles([stored], () => comms.addResource(actorOf(req), v, stored)));
  });
  app.delete('/resources/:id', { preHandler: requireStaff('comms:write') }, async (req, reply) => {
    await comms.deleteResource(actorOf(req), params(req, 'id').id);
    return reply.status(204).send();
  });

  /* ---------- message delivery ---------- */
  app.get('/notifications', { preHandler: requireStaff('staff:manage') }, async req =>
    listNotifications(parse(z.object({ status: z.enum(['FAILED', 'PENDING']).default('FAILED') }), req.query).status));
  app.post('/notifications/:id/retry', { preHandler: requireStaff('staff:manage') }, async req => retryNotification(actorOf(req), params(req, 'id').id));
}

export async function communicationsPortalRoutes(app: FastifyInstance) {
  app.get('/announcements', async () => comms.listAnnouncements(50));
  app.get('/resources', async () => comms.listResources());
  app.get('/resources/:id/download', async (req, reply) => sendDocument(reply, await comms.resourceDocument(params(req, 'id').id)));
}

export async function communicationsPublicRoutes(app: FastifyInstance) {
  app.get('/announcements', async () => comms.listAnnouncements(10));
}

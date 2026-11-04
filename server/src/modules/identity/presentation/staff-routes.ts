import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { params } from '../../../shared/http.js';
import { parse, s } from '../../../shared/validation.js';
import { STAFF_ROLES } from '../domain/roles.js';
import { resendInvite } from '../application/passwords.js';
import { inviteStaff, listStaff, updateStaff } from '../application/staff.js';
import { actorOf, requireStaff, userOf } from './guards.js';

export default async function staffAdminRoutes(app: FastifyInstance) {
  app.get('/staff', { preHandler: requireStaff('staff:manage') }, async () => listStaff());
  app.post('/staff', { preHandler: requireStaff('staff:manage') }, async (req, reply) => {
    const v = parse(z.object({ email: s.email, name: s.name(120), role: z.enum(STAFF_ROLES), title: z.string().trim().max(80).optional() }), req.body);
    return reply.status(201).send(await inviteStaff(actorOf(req), v));
  });
  app.patch('/staff/:id', { preHandler: requireStaff('staff:manage') }, async req => {
    const v = parse(z.object({ name: s.name(120), role: z.enum(STAFF_ROLES), title: z.string().trim().max(80).nullable(), active: z.boolean(), resetMfa: z.literal(true) }).partial(), req.body);
    return updateStaff({ ...actorOf(req), id: userOf(req).id }, params(req, 'id').id, v);
  });
  app.post('/staff/:id/resend-invite', { preHandler: requireStaff('staff:manage') }, async (req, reply) => {
    await resendInvite(params(req, 'id').id);
    return reply.status(204).send();
  });
}

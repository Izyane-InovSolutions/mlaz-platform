import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { params } from '../../../shared/http.js';
import { parse, s } from '../../../shared/validation.js';
import { actorOf, requireStaff } from '../../identity/http.js';
import * as expenses from '../application/expenses.js';

export default async function financeAdminRoutes(app: FastifyInstance) {
  app.get('/expenses/categories', { preHandler: requireStaff('expenses:read') }, async () => ({ categories: expenses.EXPENSE_CATEGORIES, methods: expenses.EXPENSE_METHODS }));
  app.get('/expenses', { preHandler: requireStaff('expenses:read') }, async req =>
    expenses.list(parse(z.object({ from: s.date.optional(), to: s.date.optional(), category: z.string().optional(), eventId: z.uuid().optional() }), req.query)));
  app.get('/expenses/:ref', { preHandler: requireStaff('expenses:read') }, async req => expenses.get(params(req, 'ref').ref));
  app.post('/expenses', { preHandler: requireStaff('expenses:write') }, async (req, reply) => reply.status(201).send(await expenses.create(actorOf(req), req.body)));
  app.delete('/expenses/:ref', { preHandler: requireStaff('expenses:write') }, async (req, reply) => {
    await expenses.remove(actorOf(req), params(req, 'ref').ref);
    return reply.status(204).send();
  });
}

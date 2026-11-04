import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { params, rateLimit } from '../../../shared/http.js';
import { parse } from '../../../shared/validation.js';
import { actorOf, memberIdOf, userOf } from '../../identity/http.js';
import { creditCheck, creditCheckHistory } from '../application/credit-checks.js';
import { createLoan, deleteLoan, listLoans, updateLoan } from '../application/loans.js';

/** The member's loan book and credit checks. */
export default async function lendingPortalRoutes(app: FastifyInstance) {
  app.get('/loans', async req => listLoans(memberIdOf(req), parse(z.object({ filter: z.enum(['all', 'good', 'bad']).optional(), q: z.string().trim().max(100).optional() }), req.query)));
  app.post('/loans', async (req, reply) => reply.status(201).send(await createLoan(memberIdOf(req), req.body)));
  app.patch('/loans/:id', async req => updateLoan(memberIdOf(req), params(req, 'id').id, req.body));
  app.delete('/loans/:id', async (req, reply) => {
    await deleteLoan(memberIdOf(req), params(req, 'id').id);
    return reply.status(204).send();
  });
  app.post('/credit-checks', rateLimit(20, '1 minute'), async req => creditCheck(userOf(req), actorOf(req), req.body));
  app.get('/credit-checks', async req => creditCheckHistory(memberIdOf(req)));
}

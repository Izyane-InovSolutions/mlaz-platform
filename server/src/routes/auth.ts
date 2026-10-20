import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { passwordSchema } from '../lib/auth.js';
import { authenticate, userOf } from '../lib/guards.js';
import { parse, s } from '../lib/validate.js';
import * as accounts from '../services/accounts.js';
import { rateLimit } from './helpers.js';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', rateLimit(10, '5 minutes'), async req => {
    const v = parse(z.object({ email: s.email, password: z.string().min(1).max(200), portal: z.enum(['staff', 'member']).optional() }), req.body);
    return accounts.login(v.email, v.password, v.portal, req.ip);
  });

  app.post('/refresh', rateLimit(30, '1 minute'), async req => {
    const v = parse(z.object({ refreshToken: z.string().min(20) }), req.body);
    return accounts.refresh(v.refreshToken);
  });

  app.post('/logout', async (req, reply) => {
    const v = parse(z.object({ refreshToken: z.string().min(20) }), req.body);
    await accounts.logout(v.refreshToken);
    return reply.status(204).send();
  });

  app.get('/me', async req => {
    await authenticate(req);
    return accounts.profile(userOf(req).id);
  });

  app.post('/password/forgot', rateLimit(5, '15 minutes'), async (req, reply) => {
    const v = parse(z.object({ email: s.email }), req.body);
    await accounts.requestPasswordReset(v.email);
    return reply.status(204).send();
  });

  /** Sets a password from an invite or reset link. */
  app.post('/password/set', rateLimit(10, '15 minutes'), async req => {
    const v = parse(z.object({ token: z.string().min(20), password: passwordSchema }), req.body);
    return accounts.setPassword(v.token, v.password);
  });

  app.post('/password/change', async (req, reply) => {
    await authenticate(req);
    const v = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
    await accounts.changePassword(userOf(req), v.currentPassword, v.newPassword);
    return reply.status(204).send();
  });
}

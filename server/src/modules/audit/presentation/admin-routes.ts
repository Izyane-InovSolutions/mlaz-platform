import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, s } from '../../../shared/validation.js';
import { requireStaff } from '../../identity/http.js';
import { searchAuditLog } from '../application/audit-log.js';

export default async function auditAdminRoutes(app: FastifyInstance) {
  app.get('/audit', { preHandler: requireStaff('reports:read') }, async req =>
    searchAuditLog(parse(s.page.extend({ target: z.string().trim().max(60).optional(), q: z.string().trim().max(100).optional() }), req.query)));
}

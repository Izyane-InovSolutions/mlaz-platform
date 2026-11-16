import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { datedName, params, sendCsv } from '../../../shared/http.js';
import { parse, s } from '../../../shared/validation.js';
import { actorOf, memberIdOf, requireStaff, userOf } from '../../identity/http.js';
import { memberOverview, navCounts, overview, paymentsSummary, search, siteConfig } from '../application/dashboards.js';
import { buildReport, exportReport, reportCatalogue } from '../application/reports.js';

export async function reportingAdminRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: requireStaff('dashboard:view') }, async req => overview(userOf(req)));
  app.get('/nav-counts', { preHandler: requireStaff() }, async () => navCounts());
  app.get('/search', { preHandler: requireStaff() }, async req => search(userOf(req), parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query).q));
  app.get('/payments/summary', { preHandler: requireStaff('payments:read') }, async () => paymentsSummary());

  app.get('/reports', { preHandler: requireStaff('reports:read') }, async () => reportCatalogue());
  app.get('/reports/:key', { preHandler: requireStaff('reports:read') }, async (req, reply) => {
    const q = parse(z.object({ format: z.enum(['json', 'csv']).default('json'), from: s.date.optional(), to: s.date.optional() }), req.query);
    const { key } = params(req, 'key');
    if (q.format === 'json') return buildReport(key, q);
    const r = await exportReport(actorOf(req), key, q);
    return sendCsv(reply, datedName(`mlaz-${r.key}`, 'csv'), r.csv);
  });
}

export async function reportingPortalRoutes(app: FastifyInstance) {
  app.get('/overview', async req => memberOverview(memberIdOf(req)));
}

export async function reportingPublicRoutes(app: FastifyInstance) {
  app.get('/config', async () => siteConfig());
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateOnly } from '../../../shared/dates.js';
import { datedName, params, rateLimit, sendCsv, sendPdf } from '../../../shared/http.js';
import { PROVINCES, parse, s } from '../../../shared/validation.js';
import { timelineFor } from '../../audit/index.js';
import { commitFiles, requireFile, storeFile } from '../../documents/index.js';
import { readMultipart } from '../../documents/http.js';
import { actorOf, memberIdOf, requireStaff } from '../../identity/http.js';
import { checkoutSchema, offlineSchema } from '../../payments/index.js';
import { reinstate } from '../application/accreditation.js';
import { directory, publicStats, verify } from '../application/directory.js';
import { duesOverview, recordOfflineDues, startDuesPayment } from '../application/dues.js';
import { memberCertificate, ownProfile, updateOwnProfile } from '../application/member-portal.js';
import * as members from '../application/members-admin.js';
import { listRenewals, myRenewals, rejectRenewal, submitRenewal, verifyRenewal } from '../application/renewals.js';

const reason = z.object({ reason: s.text(1000) });

export async function membershipAdminRoutes(app: FastifyInstance) {
  /* ---------- members ---------- */
  app.get('/members', { preHandler: requireStaff('members:read') }, async req => members.list(parse(members.listQuery, req.query)));
  app.get('/members/export.csv', { preHandler: requireStaff('members:read') }, async (req, reply) =>
    sendCsv(reply, datedName('mlaz-members', 'csv'), await members.exportCsv(parse(members.listQuery, req.query))));
  app.get('/members/:number', { preHandler: requireStaff('members:read') }, async req => members.detail(params(req, 'number').number));
  app.patch('/members/:number', { preHandler: requireStaff('members:write') }, async req => members.update(actorOf(req), params(req, 'number').number, req.body));

  app.post('/members/:number/suspend', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    await members.suspendMember(actorOf(req), params(req, 'number').number, parse(reason, req.body).reason);
    return reply.status(204).send();
  });
  app.post('/members/:number/reinstate', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    await reinstate(actorOf(req), params(req, 'number').number);
    return reply.status(204).send();
  });
  app.post('/members/:number/reminders', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    await members.sendDuesReminder(actorOf(req), params(req, 'number').number);
    return reply.status(204).send();
  });
  app.post('/members/:number/offline-dues', { preHandler: requireStaff('payments:record') }, async (req, reply) =>
    reply.status(201).send(await recordOfflineDues(actorOf(req), params(req, 'number').number, parse(offlineSchema, req.body))));
  app.post('/members/:number/users', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    const v = parse(z.object({ email: s.email, name: s.name(120) }), req.body);
    return reply.status(201).send(await members.inviteMemberUser(actorOf(req), params(req, 'number').number, v.email, v.name));
  });
  app.patch('/members/:number/users/:userId', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    const { number, userId } = params(req, 'number', 'userId');
    await members.setPortalUserActive(actorOf(req), number, userId, parse(z.object({ active: z.boolean() }), req.body).active);
    return reply.status(204).send();
  });
  app.get('/members/:number/certificate.pdf', { preHandler: requireStaff('members:read') }, async (req, reply) => {
    const c = await members.staffCertificate(params(req, 'number').number);
    return sendPdf(reply, c.filename, c.pdf);
  });

  /* ---------- MoF renewals & certificates ---------- */
  app.get('/renewals', { preHandler: requireStaff('members:read') }, async req =>
    listRenewals(parse(z.object({ status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING') }), req.query).status));
  app.post('/renewals/:id/verify', { preHandler: requireStaff('renewals:verify') }, async req =>
    verifyRenewal(actorOf(req), params(req, 'id').id, dateOnly(parse(z.object({ mofExpiry: s.date }), req.body).mofExpiry)));
  app.post('/renewals/:id/reject', { preHandler: requireStaff('renewals:verify') }, async (req, reply) => {
    await rejectRenewal(actorOf(req), params(req, 'id').id, parse(reason, req.body).reason);
    return reply.status(204).send();
  });
  app.get('/certificates', { preHandler: requireStaff('members:read') }, async req =>
    members.certificatesList(parse(z.object({ status: z.enum(['VALID', 'SUPERSEDED', 'REVOKED']).optional() }), req.query)));
}

/** The member's own business: profile, certificate, MoF renewals and dues. */
export async function membershipPortalRoutes(app: FastifyInstance) {
  app.get('/profile', async req => ownProfile(memberIdOf(req)));
  app.patch('/profile', async req => updateOwnProfile(actorOf(req), memberIdOf(req), req.body));
  app.get('/activity', async req => timelineFor(memberIdOf(req), 100));

  app.get('/certificate.pdf', async (req, reply) => {
    const c = await memberCertificate(memberIdOf(req));
    return sendPdf(reply, c.filename, c.pdf);
  });

  app.get('/mof-renewals', async req => myRenewals(memberIdOf(req)));
  app.post('/mof-renewals', rateLimit(20, '1 hour'), async (req, reply) => {
    const { fields, files } = await readMultipart(req);
    const v = parse(z.object({ mofRef: s.text(60) }), fields);
    const stored = await storeFile(requireFile(files, 'file', 'renewed MoF authorization'), 'MOF_AUTHORIZATION');
    return reply.status(201).send(await commitFiles([stored], () => submitRenewal(actorOf(req), memberIdOf(req), v.mofRef, stored)));
  });

  app.get('/dues', async req => duesOverview(memberIdOf(req)));
  app.post('/dues/payments', async (req, reply) =>
    reply.status(201).send(await startDuesPayment(actorOf(req), memberIdOf(req), parse(checkoutSchema, req.body))));
}

/** Lender verification and the public directory. */
export async function membershipPublicRoutes(app: FastifyInstance) {
  app.get('/stats', async () => publicStats());
  app.get('/verify', rateLimit(30, '1 minute'), async req => verify(parse(z.object({ q: z.string().max(100) }), req.query).q));
  app.get('/directory', rateLimit(60, '1 minute'), async req =>
    directory(parse(s.page.extend({ q: z.string().trim().max(100).optional(), province: z.enum(PROVINCES).optional(), tier: z.string().max(40).optional(), sort: z.enum(['name', 'recent']).optional() }), req.query)));
}

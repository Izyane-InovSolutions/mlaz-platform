import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateOnly } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { conflict } from '../lib/errors.js';
import { actorOf, requireStaff } from '../lib/guards.js';
import { parse, s } from '../lib/validate.js';
import * as applications from '../services/applications.js';
import * as members from '../services/members.js';
import { memberByNumber, reinstate, rejectRenewal, verifyRenewal } from '../services/membership.js';
import { offlineSchema } from '../services/payments.js';
import { certificatePdf } from '../services/pdf.js';
import { sendCsv, sendPdf } from './helpers.js';

const reason = z.object({ reason: s.text(1000) });
type P<K extends string> = { [k in K]: string };

export default async function adminMemberRoutes(app: FastifyInstance) {
  /* ---------- members ---------- */
  app.get('/members', { preHandler: requireStaff('members:read') }, async req => members.list(parse(members.listQuery, req.query)));
  app.get('/members/export.csv', { preHandler: requireStaff('members:read') }, async (req, reply) =>
    sendCsv(reply, `mlaz-members-${new Date().toISOString().slice(0, 10)}.csv`, await members.exportCsv(parse(members.listQuery, req.query))));
  app.get('/members/:number', { preHandler: requireStaff('members:read') }, async req => members.detail((req.params as P<'number'>).number));
  app.patch('/members/:number', { preHandler: requireStaff('members:write') }, async req => members.update(actorOf(req), (req.params as P<'number'>).number, req.body));

  app.post('/members/:number/suspend', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    await members.suspendMember(actorOf(req), (req.params as P<'number'>).number, parse(reason, req.body).reason);
    return reply.status(204).send();
  });
  app.post('/members/:number/reinstate', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    await reinstate(actorOf(req), (req.params as P<'number'>).number);
    return reply.status(204).send();
  });
  app.post('/members/:number/reminders', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    await members.sendDuesReminder(actorOf(req), (req.params as P<'number'>).number);
    return reply.status(204).send();
  });
  app.post('/members/:number/offline-dues', { preHandler: requireStaff('payments:record') }, async (req, reply) =>
    reply.status(201).send(await members.recordOfflineDues(actorOf(req), (req.params as P<'number'>).number, parse(offlineSchema, req.body))));
  app.post('/members/:number/users', { preHandler: requireStaff('members:write') }, async (req, reply) => {
    const v = parse(z.object({ email: s.email, name: s.text(120) }), req.body);
    return reply.status(201).send(await members.inviteMemberUser(actorOf(req), (req.params as P<'number'>).number, v.email, v.name));
  });
  app.get('/members/:number/certificate.pdf', { preHandler: requireStaff('members:read') }, async (req, reply) => {
    const m = await memberByNumber(prisma, (req.params as P<'number'>).number);
    const cert = await prisma.certificate.findFirst({ where: { memberId: m.id }, orderBy: { issuedAt: 'desc' } });
    if (!cert) throw conflict('No certificate has been issued to this member.');
    return sendPdf(reply, `mlaz-certificate-${m.number}.pdf`, await certificatePdf(m, cert));
  });

  /* ---------- MoF renewals & certificates ---------- */
  app.get('/renewals', { preHandler: requireStaff('members:read') }, async req => {
    const q = parse(z.object({ status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING') }), req.query);
    return prisma.mofRenewal.findMany({
      where: { status: q.status }, orderBy: { submittedAt: 'asc' },
      include: { member: { select: { number: true, name: true, mofRef: true, mofExpiry: true, status: true } }, document: { select: { id: true, filename: true, mimeType: true } } },
    });
  });
  app.post('/renewals/:id/verify', { preHandler: requireStaff('renewals:verify') }, async req => {
    const v = parse(z.object({ mofExpiry: s.date }), req.body);
    return verifyRenewal(actorOf(req), (req.params as P<'id'>).id, dateOnly(v.mofExpiry));
  });
  app.post('/renewals/:id/reject', { preHandler: requireStaff('renewals:verify') }, async (req, reply) => {
    await rejectRenewal(actorOf(req), (req.params as P<'id'>).id, parse(reason, req.body).reason);
    return reply.status(204).send();
  });
  app.get('/certificates', { preHandler: requireStaff('members:read') }, async req =>
    members.certificatesList(parse(z.object({ status: z.enum(['VALID', 'SUPERSEDED', 'REVOKED']).optional() }), req.query)));

  /* ---------- applications ---------- */
  app.get('/applications', { preHandler: requireStaff('applications:read') }, async req =>
    applications.list(parse(s.page.extend({ stage: z.enum(['OPEN', 'DETAILS', 'MOF_REVIEW', 'AWAITING_APPROVAL', 'PAYMENT_PENDING', 'ACCREDITED', 'REJECTED']).optional(), q: z.string().trim().max(100).optional() }), req.query)));
  app.get('/applications/:ref', { preHandler: requireStaff('applications:read') }, async req => applications.detail((req.params as P<'ref'>).ref));

  const act = (fn: (ref: string, req: Parameters<typeof actorOf>[0]) => Promise<unknown>) => async (req: Parameters<typeof actorOf>[0]) => {
    const ref = (req.params as P<'ref'>).ref;
    await fn(ref, req);
    return applications.detail(ref);
  };
  app.post('/applications/:ref/recommend', { preHandler: requireStaff('applications:recommend') }, act((ref, req) => applications.recommend(req.user!, actorOf(req), ref, req.body)));
  app.post('/applications/:ref/approve', { preHandler: requireStaff('applications:approve') }, act((ref, req) => applications.approve(req.user!, actorOf(req), ref)));
  app.post('/applications/:ref/decline-recommendation', { preHandler: requireStaff('applications:approve') }, act((ref, req) => applications.declineRecommendation(actorOf(req), ref, parse(reason, req.body).reason)));
  app.post('/applications/:ref/return', { preHandler: requireStaff('applications:return') }, act((ref, req) => applications.returnToApplicant(actorOf(req), ref, parse(reason, req.body).reason)));
  app.post('/applications/:ref/reject', { preHandler: requireStaff('applications:approve') }, act((ref, req) => applications.reject(actorOf(req), ref, parse(reason, req.body).reason)));
  app.post('/applications/:ref/offline-payment', { preHandler: requireStaff('payments:record') }, async (req, reply) =>
    reply.status(201).send(await applications.recordOfflinePayment(actorOf(req), (req.params as P<'ref'>).ref, parse(offlineSchema, req.body))));
}

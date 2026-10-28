import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { fmtDate, today } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { actorOf, memberIdOf, requireMember, userOf } from '../lib/guards.js';
import { commitFiles, readMultipart, requireFile, storeFile } from '../lib/uploads.js';
import { parse, s } from '../lib/validate.js';
import { listAnnouncements, listResources } from '../services/comms.js';
import * as events from '../services/events.js';
import * as lending from '../services/lending.js';
import * as members from '../services/members.js';
import { duesInfo, inGoodStanding, memberSummary, submitRenewal } from '../services/membership.js';
import { attachProof, checkoutSchema, paymentByRef, paymentView } from '../services/payments.js';
import { certificatePdf, receiptPdf } from '../services/pdf.js';
import { rateLimit, sendDocument, sendPdf } from './helpers.js';

const FULL_PAYMENT = { lines: true, documents: { select: { id: true } }, application: true, member: true, registration: { include: { event: true } } } as const;

/** Member portal: everything is scoped to the signed-in user's member business. */
export default async function portalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireMember);

  const me = (req: FastifyRequest) => prisma.member.findUniqueOrThrow({ where: { id: memberIdOf(req) } });

  /* ---------- overview & profile ---------- */
  app.get('/overview', async req => {
    const m = await me(req);
    const [summary, recent, announcements, nextEvent] = await Promise.all([
      memberSummary(prisma, m),
      prisma.memberActivity.findMany({ where: { memberId: m.id }, orderBy: { at: 'desc' }, take: 10 }),
      listAnnouncements(3),
      prisma.event.findFirst({ where: { status: 'PUBLISHED', date: { gte: today() } }, orderBy: { date: 'asc' } }),
    ]);
    const alerts: { level: 'danger' | 'warning' | 'info'; code: string; message: string }[] = [];
    if (m.status === 'SUSPENDED') alerts.push({ level: 'danger', code: m.suspension === 'MOF_EXPIRED' ? 'MOF_EXPIRED' : 'SUSPENDED', message: m.suspension === 'MOF_EXPIRED' ? 'Your MoF authorization expired. Upload the renewed authorization to restore your accreditation.' : `Your membership is suspended: ${m.suspensionReason ?? ''}` });
    if (m.status === 'LAPSED') alerts.push({ level: 'danger', code: 'LAPSED', message: 'Your membership has lapsed. Pay your annual dues to restore your accreditation.' });
    if (m.status === 'ACTIVE' && summary.dues.payable) alerts.push({ level: 'warning', code: 'DUES_PAYABLE', message: `Annual dues for ${fmtDate(summary.dues.periodStart)} to ${fmtDate(summary.dues.periodEnd)} are now payable.` });
    return { member: summary, activity: recent, announcements, nextEvent, alerts };
  });

  app.get('/profile', async req => memberSummary(prisma, await me(req)));

  app.patch('/profile', async req => members.updateOwnProfile(actorOf(req), memberIdOf(req), req.body));

  app.get('/activity', async req => prisma.memberActivity.findMany({ where: { memberId: memberIdOf(req) }, orderBy: { at: 'desc' }, take: 100 }));

  /* ---------- certificates & MoF renewal ---------- */
  app.get('/certificate.pdf', async (req, reply) => {
    const m = await me(req);
    const cert = await prisma.certificate.findFirst({ where: { memberId: m.id, status: 'VALID' }, orderBy: { issuedAt: 'desc' } });
    if (!cert || !inGoodStanding(m)) throw conflict('Your accreditation is not currently valid, so no certificate can be issued.', 'NOT_ACCREDITED');
    return sendPdf(reply, `mlaz-certificate-${m.number}.pdf`, await certificatePdf(m, cert));
  });

  app.get('/mof-renewals', async req => prisma.mofRenewal.findMany({ where: { memberId: memberIdOf(req) }, orderBy: { submittedAt: 'desc' } }));

  app.post('/mof-renewals', rateLimit(20, '1 hour'), async (req, reply) => {
    const { fields, files } = await readMultipart(req);
    const v = parse(z.object({ mofRef: s.text(60) }), fields);
    const stored = await storeFile(requireFile(files, 'file', 'renewed MoF authorization'), 'MOF_AUTHORIZATION');
    return reply.status(201).send(await commitFiles([stored], () => submitRenewal(actorOf(req), memberIdOf(req), v.mofRef, stored)));
  });

  /* ---------- dues & payments ---------- */
  app.get('/dues', async req => {
    const m = await me(req);
    const [info, history, pending] = await Promise.all([
      duesInfo(prisma, m),
      prisma.duesPayment.findMany({ where: { memberId: m.id }, orderBy: { periodStart: 'desc' }, include: { payment: { select: { ref: true, method: true, paidAt: true } } } }),
      prisma.payment.findFirst({ where: { memberId: m.id, purpose: 'DUES', status: 'PENDING' }, include: FULL_PAYMENT }),
    ]);
    return { tier: m.tierName, validUntil: m.validUntil, ...info, history, pendingPayment: pending && (await paymentView(pending)) };
  });

  app.post('/dues/payments', async (req, reply) =>
    reply.status(201).send(await members.startDuesPayment(actorOf(req), memberIdOf(req), parse(checkoutSchema, req.body))));

  const ownPayment = async (req: FastifyRequest) => {
    const p = await paymentByRef((req.params as { ref: string }).ref);
    if (p.memberId !== memberIdOf(req)) throw notFound('Payment');
    return p;
  };

  app.get('/payments', async req => {
    const ps = await prisma.payment.findMany({ where: { memberId: memberIdOf(req) }, orderBy: { createdAt: 'desc' }, take: 100, include: FULL_PAYMENT });
    return Promise.all(ps.map(paymentView));
  });
  app.get('/payments/:ref', async req => paymentView(await ownPayment(req)));
  app.post('/payments/:ref/proof', rateLimit(20, '1 hour'), async req => {
    const p = await ownPayment(req);
    const { fields, files } = await readMultipart(req);
    const v = parse(z.object({ bankRef: s.text(60) }), fields);
    const stored = await storeFile(requireFile(files, 'proof', 'proof of payment'), 'PROOF_OF_PAYMENT');
    return paymentView(await commitFiles([stored], () => attachProof(actorOf(req), p.id, v.bankRef, stored)));
  });
  app.get('/payments/:ref/receipt.pdf', async (req, reply) => {
    const p = await ownPayment(req);
    if (p.status !== 'SUCCESS') throw conflict('A receipt is issued once the payment is confirmed.');
    return sendPdf(reply, `receipt-${p.ref}.pdf`, await receiptPdf(await paymentView(p)));
  });

  /* ---------- events ---------- */
  app.get('/events', async req => events.listForMember(memberIdOf(req)));
  app.get('/events/:id', async req => events.memberDetail((req.params as { id: string }).id, memberIdOf(req)));
  app.post('/events/:id/registrations', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const v = parse(z.object({ tickets: z.coerce.number().int() }), body);
    const checkout = body.method ? parse(checkoutSchema, body) : undefined;
    return reply.status(201).send(await events.register(actorOf(req), memberIdOf(req), (req.params as { id: string }).id, v.tickets, checkout));
  });
  app.delete('/events/:id/registration', async (req, reply) => {
    await events.cancelRegistration(actorOf(req), memberIdOf(req), (req.params as { id: string }).id);
    return reply.status(204).send();
  });

  /* ---------- announcements & resources ---------- */
  app.get('/announcements', async () => listAnnouncements(50));
  app.get('/resources', async () => listResources());
  app.get('/resources/:id/download', async (req, reply) => {
    const r = await prisma.resource.findUnique({ where: { id: (req.params as { id: string }).id }, include: { document: true } });
    if (!r) throw notFound('Resource');
    return sendDocument(reply, r.document);
  });

  /** The member's own documents (their application files, MoF renewals, proofs of payment). */
  app.get('/documents/:id', async (req, reply) => {
    const d = await prisma.document.findFirst({ where: { id: (req.params as { id: string }).id, memberId: memberIdOf(req) } });
    if (!d) throw notFound('Document');
    return sendDocument(reply, d);
  });

  /* ---------- loan book & credit checks ---------- */
  app.get('/loans', async req => lending.listLoans(memberIdOf(req), parse(z.object({ filter: z.enum(['all', 'good', 'bad']).optional(), q: z.string().trim().max(100).optional() }), req.query)));
  app.post('/loans', async (req, reply) => reply.status(201).send(await lending.createLoan(actorOf(req), memberIdOf(req), req.body)));
  app.patch('/loans/:id', async req => lending.updateLoan(memberIdOf(req), (req.params as { id: string }).id, req.body));
  app.delete('/loans/:id', async (req, reply) => {
    await lending.deleteLoan(memberIdOf(req), (req.params as { id: string }).id);
    return reply.status(204).send();
  });
  app.post('/credit-checks', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => lending.creditCheck(userOf(req), actorOf(req), req.body));
  app.get('/credit-checks', async req => lending.creditCheckHistory(memberIdOf(req)));
}

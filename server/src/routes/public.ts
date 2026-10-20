import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { applicantActor } from '../lib/audit.js';
import { today } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { readMultipart, requireFile, storeFile } from '../lib/uploads.js';
import { PROVINCES, parse, s } from '../lib/validate.js';
import * as applications from '../services/applications.js';
import { listAnnouncements } from '../services/comms.js';
import { directory, publicStats, verify } from '../services/directory.js';
import { MAX_TICKETS } from '../services/events.js';
import { notify } from '../services/notifications.js';
import { METHOD_LABEL, ONLINE_METHODS, attachProof, checkoutSchema, paymentByRef, paymentView } from '../services/payments.js';
import { certificatePdf, receiptPdf } from '../services/pdf.js';
import { fees, getSetting } from '../services/settings.js';
import { trackingUrl } from '../lib/tokens.js';
import { rateLimit, sendPdf, trackingTokenOf } from './helpers.js';

export default async function publicRoutes(app: FastifyInstance) {
  /* ---------- reference data for the website and forms ---------- */
  app.get('/config', async () => ({
    ...(await fees(prisma)),
    provinces: PROVINCES,
    paymentMethods: ONLINE_METHODS.map(code => ({ code, label: METHOD_LABEL[code] })),
    bankAccount: await getSetting(prisma, 'bankAccount'),
    maxEventTickets: MAX_TICKETS,
  }));

  app.get('/stats', async () => publicStats());
  app.get('/announcements', async () => listAnnouncements(10));
  app.get('/events', async () => {
    const events = await prisma.event.findMany({ where: { status: 'PUBLISHED', date: { gte: today() } }, orderBy: { date: 'asc' } });
    return events.map(e => ({ id: e.id, name: e.name, type: e.type, date: e.date, venue: e.venue, price: e.price }));
  });

  /* ---------- lender verification & directory ---------- */
  app.get('/verify', rateLimit(30, '1 minute'), async req => verify(parse(z.object({ q: z.string().max(100) }), req.query).q));
  app.get('/directory', rateLimit(60, '1 minute'), async req =>
    directory(parse(s.page.extend({ q: z.string().trim().max(100).optional(), province: z.enum(PROVINCES).optional(), tier: z.string().max(40).optional() }), req.query)));

  /* ---------- membership applications ---------- */
  app.post('/applications', rateLimit(10, '1 hour'), async (req, reply) => {
    const { fields, files } = await readMultipart(req);
    return reply.status(201).send(await applications.submit(fields, files, req.ip));
  });

  const load = (req: { params: unknown; headers: Record<string, unknown>; query: unknown }) =>
    applications.forApplicant((req.params as { ref: string }).ref, trackingTokenOf(req as never));

  app.get('/applications/:ref', rateLimit(60, '1 minute'), async req => applications.applicantView(await load(req)));

  app.post('/applications/:ref/mof', rateLimit(10, '1 hour'), async (req, reply) => {
    const a = await load(req);
    const { fields, files } = await readMultipart(req);
    const v = parse(z.object({ mofRef: s.text(60) }), fields);
    await applications.uploadMof(a, v.mofRef, requireFile(files, 'mofFile', 'MoF authorization document'), req.ip);
    return reply.status(201).send(await applications.applicantView(await load(req)));
  });

  app.post('/applications/:ref/payments', rateLimit(20, '1 hour'), async (req, reply) => {
    const a = await load(req);
    return reply.status(201).send(await applications.startPayment(a, parse(checkoutSchema, req.body)));
  });

  const ownPayment = async (applicationId: string, payRef: string) => {
    const p = await paymentByRef(payRef);
    if (p.applicationId !== applicationId) throw notFound(`Payment ${payRef}`);
    return p;
  };

  /** Polled by the checkout screen until the payment leaves PENDING. */
  app.get('/applications/:ref/payments/:payRef', async req => {
    const a = await load(req);
    return paymentView(await ownPayment(a.id, (req.params as { payRef: string }).payRef));
  });

  app.post('/applications/:ref/payments/:payRef/proof', rateLimit(10, '1 hour'), async req => {
    const a = await load(req);
    const p = await ownPayment(a.id, (req.params as { payRef: string }).payRef);
    const { fields, files } = await readMultipart(req);
    const v = parse(z.object({ bankRef: s.text(60) }), fields);
    const stored = await storeFile(requireFile(files, 'proof', 'proof of payment'), 'PROOF_OF_PAYMENT');
    return paymentView(await attachProof(applicantActor(a.contactName, req.ip), p.id, v.bankRef, stored));
  });

  app.get('/applications/:ref/payments/:payRef/receipt.pdf', async (req, reply) => {
    const a = await load(req);
    const p = await ownPayment(a.id, (req.params as { payRef: string }).payRef);
    if (p.status !== 'SUCCESS') throw conflict('A receipt is issued once the payment is confirmed.');
    return sendPdf(reply, `receipt-${p.ref}.pdf`, await receiptPdf(await paymentView(p)));
  });

  app.get('/applications/:ref/certificate.pdf', async (req, reply) => {
    const a = await load(req);
    const m = await prisma.member.findUnique({ where: { applicationId: a.id }, include: { certificates: { orderBy: { issuedAt: 'desc' }, take: 1 } } });
    if (!m?.certificates.length) throw conflict('The certificate is issued once payment is confirmed.');
    return sendPdf(reply, `mlaz-certificate-${m.number}.pdf`, await certificatePdf(m, m.certificates[0]));
  });

  /** Re-sends the tracking link to the applicant's email. Always 204 so it cannot be used to probe references. */
  app.post('/applications/:ref/resend-link', rateLimit(5, '1 hour'), async (req, reply) => {
    const v = parse(z.object({ email: s.email }), req.body);
    const a = await prisma.application.findUnique({ where: { ref: (req.params as { ref: string }).ref.toUpperCase() } });
    if (a && a.email.toLowerCase() === v.email) {
      await notify(prisma, { email: a.email }, { subject: `Your MLAZ application ${a.ref}`, text: `Track your application here: ${trackingUrl(a.ref)}\n\nMLAZ Secretariat` });
    }
    return reply.status(204).send();
  });
}

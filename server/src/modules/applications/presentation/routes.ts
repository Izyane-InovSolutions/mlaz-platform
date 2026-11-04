import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { params, rateLimit, sendPdf } from '../../../shared/http.js';
import { parse, s } from '../../../shared/validation.js';
import { requireFile, storeFile } from '../../documents/index.js';
import { readMultipart } from '../../documents/http.js';
import { actorOf, requireStaff, userOf } from '../../identity/http.js';
import { applicantCertificate } from '../../membership/index.js';
import { checkoutSchema, offlineSchema, paymentView, receipt } from '../../payments/index.js';
import * as applicant from '../application/applicant.js';
import * as review from '../application/review.js';

const reason = z.object({ reason: s.text(1000) });

/** The applicant's tracking token, from the x-tracking-token header or the ?t= query parameter of the emailed link. */
const trackingTokenOf = (req: FastifyRequest) => (req.headers['x-tracking-token'] as string | undefined) ?? (req.query as { t?: string }).t;
const load = (req: FastifyRequest) => applicant.forApplicant(params(req, 'ref').ref, trackingTokenOf(req));

export async function applicationsPublicRoutes(app: FastifyInstance) {
  app.post('/applications', rateLimit(10, '1 hour'), async (req, reply) => {
    const { fields, files } = await readMultipart(req);
    return reply.status(201).send(await applicant.submit(fields, files, req.ip));
  });

  app.get('/applications/:ref', rateLimit(60, '1 minute'), async req => applicant.applicantView(await load(req)));

  app.post('/applications/:ref/mof', rateLimit(10, '1 hour'), async (req, reply) => {
    const a = await load(req);
    const { fields, files } = await readMultipart(req);
    const v = parse(z.object({ mofRef: s.text(60) }), fields);
    await applicant.uploadMof(a, v.mofRef, requireFile(files, 'mofFile', 'MoF authorization document'), req.ip);
    return reply.status(201).send(await applicant.applicantView(await load(req)));
  });

  app.post('/applications/:ref/payments', rateLimit(20, '1 hour'), async (req, reply) =>
    reply.status(201).send(await applicant.startPayment(await load(req), parse(checkoutSchema, req.body))));

  /** Polled by the checkout screen until the payment leaves PENDING. */
  app.get('/applications/:ref/payments/:payRef', async req => paymentView(await applicant.applicantPayment(await load(req), params(req, 'payRef').payRef)));

  app.post('/applications/:ref/payments/:payRef/proof', rateLimit(10, '1 hour'), async req => {
    const a = await load(req);
    const p = await applicant.applicantPayment(a, params(req, 'payRef').payRef);
    const { fields, files } = await readMultipart(req);
    const v = parse(z.object({ bankRef: s.text(60) }), fields);
    const stored = await storeFile(requireFile(files, 'proof', 'proof of payment'), 'PROOF_OF_PAYMENT');
    return applicant.attachApplicantProof(a, p.id, v.bankRef, stored, req.ip);
  });

  app.get('/applications/:ref/payments/:payRef/receipt.pdf', async (req, reply) => {
    const r = await receipt(await applicant.applicantPayment(await load(req), params(req, 'payRef').payRef));
    return sendPdf(reply, r.filename, r.pdf);
  });

  app.get('/applications/:ref/certificate.pdf', async (req, reply) => {
    const c = await applicantCertificate((await load(req)).id);
    return sendPdf(reply, c.filename, c.pdf);
  });

  /** Re-sends the tracking link to the applicant's email. Always 204 so it cannot be used to probe references. */
  app.post('/applications/:ref/resend-link', rateLimit(5, '1 hour'), async (req, reply) => {
    await applicant.resendTrackingLink(params(req, 'ref').ref, parse(z.object({ email: s.email }), req.body).email);
    return reply.status(204).send();
  });
}

export async function applicationsAdminRoutes(app: FastifyInstance) {
  app.get('/applications', { preHandler: requireStaff('applications:read') }, async req =>
    review.list(parse(s.page.extend({ stage: z.enum(['OPEN', 'DETAILS', 'MOF_REVIEW', 'AWAITING_APPROVAL', 'PAYMENT_PENDING', 'ACCREDITED', 'REJECTED']).optional(), q: z.string().trim().max(100).optional() }), req.query)));
  app.get('/applications/:ref', { preHandler: requireStaff('applications:read') }, async req => review.detail(params(req, 'ref').ref));

  // Each decision answers with the application as it is now, so the console can redraw it.
  const act = (fn: (ref: string, req: FastifyRequest) => Promise<unknown>) => async (req: FastifyRequest) => {
    const { ref } = params(req, 'ref');
    await fn(ref, req);
    return review.detail(ref);
  };
  app.post('/applications/:ref/recommend', { preHandler: requireStaff('applications:recommend') }, act((ref, req) => review.recommend(userOf(req), actorOf(req), ref, req.body)));
  app.post('/applications/:ref/approve', { preHandler: requireStaff('applications:approve') }, act((ref, req) => review.approve(userOf(req), actorOf(req), ref)));
  app.post('/applications/:ref/decline-recommendation', { preHandler: requireStaff('applications:approve') }, act((ref, req) => review.declineRecommendation(actorOf(req), ref, parse(reason, req.body).reason)));
  app.post('/applications/:ref/return', { preHandler: requireStaff('applications:return') }, act((ref, req) => review.returnToApplicant(actorOf(req), ref, parse(reason, req.body).reason)));
  app.post('/applications/:ref/reject', { preHandler: requireStaff('applications:approve') }, act((ref, req) => review.reject(actorOf(req), ref, parse(reason, req.body).reason)));
  app.post('/applications/:ref/offline-payment', { preHandler: requireStaff('payments:record') }, async (req, reply) =>
    reply.status(201).send(await review.recordOfflinePayment(actorOf(req), params(req, 'ref').ref, parse(offlineSchema, req.body))));
}

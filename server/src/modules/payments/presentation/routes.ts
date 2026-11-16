import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { params, rateLimit, sendPdf } from '../../../shared/http.js';
import { parse, s } from '../../../shared/validation.js';
import { commitFiles, requireFile, storeFile } from '../../documents/index.js';
import { readMultipart } from '../../documents/http.js';
import { actorOf, memberIdOf, requireStaff } from '../../identity/http.js';
import { attachProof, confirmBankTransfer, rejectBankTransfer } from '../application/bank-transfers.js';
import { listPayments, ownedPayment, paymentByRef, paymentView, paymentsFor, receipt, viewsOf } from '../application/queries.js';
import { handleWebhook, reconcileNow } from '../application/reconciliation.js';

const listQuery = s.page.extend({
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED']).optional(),
  method: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA', 'IZYANE_QR', 'CARD', 'BANK_TRANSFER', 'CASH']).optional(),
  purpose: z.enum(['APPLICATION', 'DUES', 'EVENT']).optional(),
  awaitingReview: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  from: s.date.optional(),
  to: s.date.optional(),
});

export async function paymentsAdminRoutes(app: FastifyInstance) {
  app.get('/payments', { preHandler: requireStaff('payments:read') }, async req => listPayments(parse(listQuery, req.query)));
  app.get('/payments/:ref', { preHandler: requireStaff('payments:read') }, async req => paymentView(await paymentByRef(params(req, 'ref').ref)));
  app.get('/payments/:ref/receipt.pdf', { preHandler: requireStaff('payments:read') }, async (req, reply) => {
    const r = await receipt(await paymentByRef(params(req, 'ref').ref), 'Receipts exist only for successful payments.');
    return sendPdf(reply, r.filename, r.pdf);
  });
  app.post('/payments/:ref/confirm', { preHandler: requireStaff('payments:confirm') }, async req => confirmBankTransfer(actorOf(req), params(req, 'ref').ref));
  app.post('/payments/:ref/reject', { preHandler: requireStaff('payments:confirm') }, async req =>
    rejectBankTransfer(actorOf(req), params(req, 'ref').ref, parse(z.object({ reason: s.text(1000) }), req.body).reason));

  /** Asks the gateway about every pending online payment. Bank transfers still need a person to check the statement. */
  app.post('/payments/reconcile', { preHandler: requireStaff('payments:confirm') }, async req => reconcileNow(actorOf(req)));
}

/** The member's own payments. */
export async function paymentsPortalRoutes(app: FastifyInstance) {
  const own = (ref: string, memberId: string) => ownedPayment(ref, { memberId });

  app.get('/payments', async req => viewsOf(await paymentsFor({ memberId: memberIdOf(req) }, 100)));
  app.get('/payments/:ref', async req => paymentView(await own(params(req, 'ref').ref, memberIdOf(req))));
  app.post('/payments/:ref/proof', rateLimit(20, '1 hour'), async req => {
    const p = await own(params(req, 'ref').ref, memberIdOf(req));
    const { fields, files } = await readMultipart(req);
    const v = parse(z.object({ bankRef: s.text(60) }), fields);
    const stored = await storeFile(requireFile(files, 'proof', 'proof of payment'), 'PROOF_OF_PAYMENT');
    return paymentView(await commitFiles([stored], () => attachProof(actorOf(req), p.id, v.bankRef, stored)));
  });
  app.get('/payments/:ref/receipt.pdf', async (req, reply) => {
    const r = await receipt(await own(params(req, 'ref').ref, memberIdOf(req)));
    return sendPdf(reply, r.filename, r.pdf);
  });
}

/** Payment gateway callbacks. The raw body is kept as a string so the signature can be checked byte for byte. */
export async function paymentsWebhookRoutes(app: FastifyInstance) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post('/payments/:provider', rateLimit(300, '1 minute'), async req => {
    await handleWebhook(params(req, 'provider').provider, req.headers, String(req.body ?? ''));
    return { received: true };
  });
}

import type { FastifyInstance } from 'fastify';
import { handleWebhook } from '../services/payments.js';

/** Payment gateway callbacks. The raw body is kept as a string so the signature can be checked byte for byte. */
export default async function webhookRoutes(app: FastifyInstance) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post('/payments/:provider', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async req => {
    await handleWebhook((req.params as { provider: string }).provider, req.headers, String(req.body ?? ''));
    return { received: true };
  });
}

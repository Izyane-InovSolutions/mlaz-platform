import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Document } from '../generated/prisma/client.js';
import { storage } from '../lib/storage.js';

/**
 * Sends a stored, user-uploaded file. Always as an attachment and under a sandbox CSP, so a crafted PDF or image can
 * never run script in the API's origin even if someone opens the URL directly. Never cached.
 */
export async function sendDocument(reply: FastifyReply, doc: Pick<Document, 'storageKey' | 'mimeType' | 'filename' | 'size'>) {
  const body = await storage.stream(doc.storageKey); // streamed, never read into memory whole
  const filename = doc.filename.replace(/[^\w.\- ()]/g, '_');
  return reply
    .header('content-type', doc.mimeType)
    .header('content-length', doc.size)
    .header('x-content-type-options', 'nosniff')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .header('content-security-policy', "sandbox; default-src 'none'")
    .header('cache-control', 'private, no-store')
    .send(body);
}

export const sendPdf = (reply: FastifyReply, filename: string, pdf: Buffer) =>
  reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${filename}"`).header('cache-control', 'private, no-store').send(pdf);

export const sendCsv = (reply: FastifyReply, filename: string, csv: string) =>
  reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${filename}"`).send(csv);

/** The applicant's tracking token, from the x-tracking-token header or the ?t= query parameter of the emailed link. */
export const trackingTokenOf = (req: FastifyRequest) => (req.headers['x-tracking-token'] as string | undefined) ?? (req.query as { t?: string }).t;

export const rateLimit = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

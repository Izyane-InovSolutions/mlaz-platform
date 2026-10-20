import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Document } from '../generated/prisma/client.js';
import { storage } from '../lib/storage.js';

/** Streams a stored document back with a safe filename. Private, never cached by intermediaries. */
export async function sendDocument(reply: FastifyReply, doc: Pick<Document, 'storageKey' | 'mimeType' | 'filename'>, download = false) {
  const body = await storage.get(doc.storageKey);
  return reply
    .header('content-type', doc.mimeType)
    .header('content-disposition', `${download ? 'attachment' : 'inline'}; filename="${doc.filename.replace(/"/g, '')}"`)
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

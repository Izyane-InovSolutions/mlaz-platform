import type { FastifyReply } from 'fastify';
import type { Document } from '../../../generated/prisma/client.js';
import { openStored } from '../application/files.js';

/**
 * Sends a stored, user-uploaded file. Always as an attachment and under a sandbox CSP, so a crafted PDF or image can
 * never run script in the API's origin even if someone opens the URL directly. Never cached.
 */
export async function sendDocument(reply: FastifyReply, doc: Pick<Document, 'storageKey' | 'mimeType' | 'filename' | 'size'>) {
  const body = await openStored(doc.storageKey); // streamed, never read into memory whole
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

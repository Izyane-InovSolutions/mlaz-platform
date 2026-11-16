import type { FastifyInstance } from 'fastify';
import { params } from '../../../shared/http.js';
import { actorOf, memberIdOf, requireStaff } from '../../identity/http.js';
import { documentForMember, documentForStaff } from '../application/records.js';
import { sendDocument } from './send-document.js';

/** Any uploaded document (MoF authorization, PACRA, NRC, proof of payment). Viewing is audited. */
export async function documentsAdminRoutes(app: FastifyInstance) {
  app.get('/documents/:id', { preHandler: requireStaff('documents:read') }, async (req, reply) =>
    sendDocument(reply, await documentForStaff(actorOf(req), params(req, 'id').id)));
}

/** The member's own documents (their application files, MoF renewals, proofs of payment). */
export async function documentsPortalRoutes(app: FastifyInstance) {
  app.get('/documents/:id', async (req, reply) => sendDocument(reply, await documentForMember(memberIdOf(req), params(req, 'id').id)));
}

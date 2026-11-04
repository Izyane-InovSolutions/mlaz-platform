import type { Actor } from '../../../shared/actor.js';
import { type Db, type Tx, prisma } from '../../../shared/db.js';
import { notFound } from '../../../shared/errors.js';
import { audit } from '../../audit/index.js';
import type { StoredFile } from './files.js';

// Document records. Only this module writes the Document table; other modules attach files to their records through
// these functions, inside their own transaction.

interface DocumentOwner { applicationId?: string | null; memberId?: string | null; paymentId?: string | null }

/** Records stored files against their owner. Returns the rows (one per file, in order). */
export async function recordDocuments(tx: Tx, stored: StoredFile[], owner: DocumentOwner, uploadedBy: string) {
  const rows = [];
  for (const f of stored) rows.push(await tx.document.create({ data: { ...f, ...owner, uploadedBy } }));
  return rows;
}

export async function recordDocument(tx: Tx, stored: StoredFile, owner: DocumentOwner, uploadedBy: string) {
  const [row] = await recordDocuments(tx, [stored], owner, uploadedBy);
  return row;
}

/** Marks an application's MoF authorization documents as replaced (a new one was uploaded, or it was returned). */
export const supersedeMofDocuments = (tx: Tx, applicationId: string) =>
  tx.document.updateMany({ where: { applicationId, kind: 'MOF_AUTHORIZATION' }, data: { superseded: true } });

/** An accredited application's documents become the new member's. */
export const assignApplicationDocuments = (tx: Tx, applicationId: string, memberId: string) =>
  tx.document.updateMany({ where: { applicationId }, data: { memberId } });

/** The kinds of document an application currently has on file (superseded ones excluded). */
export const currentDocumentKinds = async (db: Db, applicationId: string) =>
  (await db.document.findMany({ where: { applicationId, superseded: false }, select: { kind: true } })).map(d => d.kind);

/** Any uploaded document, for staff. Viewing is audited against the record it belongs to. */
export async function documentForStaff(actor: Actor, id: string) {
  const d = await prisma.document.findUnique({ where: { id }, include: { application: { select: { ref: true } }, member: { select: { number: true } } } });
  if (!d) throw notFound('Document');
  await audit(prisma, actor, d.application?.ref ?? d.member?.number ?? 'Documents', 'Document viewed', `${d.kind} · ${d.filename}`);
  return d;
}

/** One of the member's own documents (application files, MoF renewals, proofs of payment). */
export async function documentForMember(memberId: string, id: string) {
  const d = await prisma.document.findFirst({ where: { id, memberId } });
  if (!d) throw notFound('Document');
  return d;
}

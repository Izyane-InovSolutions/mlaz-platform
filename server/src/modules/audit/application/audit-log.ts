import type { Prisma as P } from '../../../generated/prisma/client.js';
import type { Actor } from '../../../shared/actor.js';
import { type Db, prisma } from '../../../shared/db.js';

// The audit trail (every change, with who and when) and each member's timeline. Both are append-only and are written
// in the same transaction as the change they describe: pass that transaction as `db`.

export function audit(db: Db, actor: Actor, target: string, action: string, note = '') {
  return db.auditLog.create({
    data: { actorType: actor.type, actorId: actor.id, actorLabel: actor.label, target, action, note, ip: actor.ip },
  });
}

/** Adds an entry to a member's timeline (shown in the console and the member portal). */
export function activity(db: Db, memberId: string, kind: string, title: string, detail = '') {
  return db.memberActivity.create({ data: { memberId, kind, title, detail } });
}

/** The audit entries for one record (an application ref, a member number, "Payments"...), newest first. */
export const trailFor = (target: string, take?: number) => prisma.auditLog.findMany({ where: { target }, orderBy: { at: 'desc' }, ...(take && { take }) });

export const timelineFor = (memberId: string, take: number) => prisma.memberActivity.findMany({ where: { memberId }, orderBy: { at: 'desc' }, take });

export async function searchAuditLog(q: { target?: string; q?: string; page: number; pageSize: number }) {
  const where: P.AuditLogWhereInput = {
    ...(q.target && { target: q.target }),
    ...(q.q && { OR: [{ action: { contains: q.q, mode: 'insensitive' } }, { actorLabel: { contains: q.q, mode: 'insensitive' } }, { note: { contains: q.q, mode: 'insensitive' } }] }),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

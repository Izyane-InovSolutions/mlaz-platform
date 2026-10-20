import type { ActorType } from '../generated/prisma/client.js';
import type { Db } from './db.js';

/** Who did something. Every service function that changes data takes one, so the audit trail always names a person. */
export interface Actor {
  type: ActorType;
  id?: string;
  label: string;
  ip?: string;
}

export const SYSTEM: Actor = { type: 'SYSTEM', label: 'System' };
export const applicantActor = (contactName: string, ip?: string): Actor => ({ type: 'APPLICANT', label: `${contactName} (applicant)`, ip });

export function audit(db: Db, actor: Actor, target: string, action: string, note = '') {
  return db.auditLog.create({
    data: { actorType: actor.type, actorId: actor.id, actorLabel: actor.label, target, action, note, ip: actor.ip },
  });
}

/** Adds an entry to a member's timeline (shown in the console and the member portal). */
export function activity(db: Db, memberId: string, kind: string, title: string, detail = '') {
  return db.memberActivity.create({ data: { memberId, kind, title, detail } });
}

import type { Actor } from '../../../shared/actor.js';
import { prisma } from '../../../shared/db.js';
import { badRequest, conflict, notFound } from '../../../shared/errors.js';
import { audit } from '../../audit/index.js';
import { ROLE_LABEL, type StaffRole } from '../domain/roles.js';
import { sendInvite } from './passwords.js';
import { endAllSessions } from './sessions.js';

// Secretariat staff accounts, and switching a member business's portal users on or off.

export async function listStaff() {
  const users = await prisma.user.findMany({ where: { role: { not: 'MEMBER' } }, orderBy: { name: 'asc' } });
  return users.map(u => ({
    id: u.id, email: u.email, name: u.name, title: u.title, role: u.role, roleLabel: ROLE_LABEL[u.role], active: u.active,
    invitePending: !u.passwordHash, mfaEnabled: !!u.totpEnabledAt, lastLoginAt: u.lastLoginAt,
  }));
}

/** Creates a staff account and emails its set-password link. */
export async function inviteStaff(actor: Actor, v: { email: string; name: string; role: StaffRole; title?: string }) {
  const u = await prisma.$transaction(async tx => {
    const user = await sendInvite(tx, { ...v, title: v.title || ROLE_LABEL[v.role] });
    await audit(tx, actor, 'Staff', 'Staff account created', `${v.email} · ${ROLE_LABEL[v.role]}`);
    return user;
  });
  return { id: u.id, email: u.email, name: u.name, role: u.role, title: u.title };
}

export async function updateStaff(actor: Actor & { id: string }, id: string, data: { role?: StaffRole; title?: string | null; active?: boolean; name?: string; resetMfa?: boolean }) {
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || u.role === 'MEMBER') throw notFound('Staff user');
  if (id === actor.id && (data.active === false || (data.role && data.role !== 'ADMIN') || data.resetMfa)) throw badRequest('You cannot deactivate yourself, remove your own admin role or reset your own two-factor sign-in here.');
  const losingAdmin = u.role === 'ADMIN' && (data.active === false || (data.role && data.role !== 'ADMIN'));
  if (losingAdmin && (await prisma.user.count({ where: { role: 'ADMIN', active: true } })) <= 1) throw conflict('There must be at least one active Secretariat Admin.');
  const { resetMfa, ...fields } = data;
  const updated = await prisma.$transaction(async tx => {
    const updated = await tx.user.update({
      where: { id },
      data: { ...fields, ...(resetMfa && { totpEnabledAt: null, totpSecret: null, totpLastStep: null, recoveryCodes: [] }) },
    });
    // Losing access (or a lost second factor) ends every session at once.
    if (data.active === false || resetMfa || (data.role && data.role !== u.role)) await endAllSessions(id, tx);
    const changes = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(' · ');
    await audit(tx, actor, 'Staff', 'Staff account updated', `${u.email} · ${changes}`);
    return updated;
  });
  return { id: updated.id, email: updated.email, name: updated.name, role: updated.role, title: updated.title, active: updated.active, mfaEnabled: !!updated.totpEnabledAt };
}

/** Turns a member's portal user on or off (e.g. someone who left the business). The member is named for the audit trail. */
export async function setMemberUserActive(actor: Actor, member: { id: string; number: string }, userId: string, active: boolean) {
  const u = await prisma.user.findFirst({ where: { id: userId, memberId: member.id, role: 'MEMBER' } });
  if (!u) throw notFound('Portal user');
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: u.id }, data: { active } });
    if (!active) await endAllSessions(u.id, tx);
    await audit(tx, actor, member.number, active ? 'Portal user reactivated' : 'Portal user deactivated', u.email);
  });
}

/** A member business's portal users, for the console. */
export async function memberPortalUsers(memberId: string) {
  const users = await prisma.user.findMany({ where: { memberId }, select: { id: true, email: true, name: true, active: true, passwordHash: true, lastLoginAt: true } });
  return users.map(({ passwordHash, ...u }) => ({ ...u, invitePending: !passwordHash }));
}

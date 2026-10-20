import type { Role, TokenPurpose } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { type Actor, audit } from '../lib/audit.js';
import { type AuthUser, hashPassword, signAccessToken, staffLabel, verifyPassword } from '../lib/auth.js';
import { type Db, prisma } from '../lib/db.js';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { ROLE_LABEL, isStaffRole, permissionsFor } from '../lib/rbac.js';
import { randomToken, sha256 } from '../lib/tokens.js';
import { T, notify } from './notifications.js';

const USER_SELECT = { id: true, email: true, name: true, title: true, role: true, memberId: true } as const;

// Verifying against a throwaway hash when the email is unknown keeps the response time the same either way.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashPassword(randomToken()));

export async function profile(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...USER_SELECT, member: { select: { id: true, number: true, name: true } } },
  });
  return {
    id: u.id, email: u.email, name: u.name, title: u.title, role: u.role, roleLabel: u.title || ROLE_LABEL[u.role],
    permissions: permissionsFor(u.role), member: u.member,
  };
}

async function issueSession(user: AuthUser) {
  const refreshToken = randomToken(48);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 864e5) },
  });
  return {
    accessToken: signAccessToken(user),
    refreshToken,
    expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60,
    user: await profile(user.id),
  };
}

export async function login(email: string, password: string, portal: 'staff' | 'member' | undefined, ip: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : (await verifyPassword(await dummy(), password), false);
  if (!user || !ok || !user.active) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (portal === 'staff' && !isStaffRole(user.role)) throw forbidden('This account does not have Secretariat access.', 'WRONG_PORTAL');
  if (portal === 'member' && isStaffRole(user.role)) throw forbidden('Secretariat accounts sign in to the Secretariat console.', 'WRONG_PORTAL');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, { type: isStaffRole(user.role) ? 'STAFF' : 'MEMBER', id: user.id, label: isStaffRole(user.role) ? staffLabel(user) : `${user.name} (member)`, ip }, 'Accounts', 'Signed in');
  return issueSession(user);
}

/**
 * Exchanges a refresh token for a new pair (rotation). Presenting a token that was already rotated means it leaked,
 * so every session of that user is revoked.
 */
export async function refresh(token: string) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row) throw unauthorized('Your session has ended. Sign in again.');
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw unauthorized('Your session has ended. Sign in again.');
  }
  if (row.expiresAt < new Date() || !row.user.active) throw unauthorized('Your session has ended. Sign in again.');
  const revoked = await prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!revoked.count) throw unauthorized('Your session has ended. Sign in again.');
  return issueSession(row.user);
}

export async function logout(token: string) {
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

async function createToken(db: Db, userId: string, purpose: TokenPurpose, ttlHours: number) {
  const token = randomToken();
  await db.userToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlHours * 3600e3) } });
  return token;
}
const setPasswordUrl = (token: string) => `${config.PUBLIC_APP_URL}/#/set-password?token=${token}`;

/** Creates a user with no password and emails them a link to set one. */
export async function inviteUser(db: Db, data: { email: string; name: string; role: Role; title?: string | null; memberId?: string | null }) {
  const email = data.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw conflict(`An account already exists for ${email}.`, 'EMAIL_TAKEN');
  const user = await db.user.create({ data: { email, name: data.name, role: data.role, title: data.title ?? null, memberId: data.memberId ?? null } });
  const url = setPasswordUrl(await createToken(db, user.id, 'INVITE', 24 * 7));
  return { user, url };
}

export async function sendInvite(db: Db, data: Parameters<typeof inviteUser>[1]) {
  const { user, url } = await inviteUser(db, data);
  await notify(db, { email: user.email }, T.invite(user.name, url, isStaffRole(user.role)));
  return user;
}

export async function resendInvite(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User');
  if (user.passwordHash) throw conflict('This user has already set a password.');
  await prisma.$transaction(async tx => {
    const url = setPasswordUrl(await createToken(tx, user.id, 'INVITE', 24 * 7));
    await notify(tx, { email: user.email }, T.invite(user.name, url, isStaffRole(user.role)));
  });
}

/** Always succeeds, so the response does not reveal whether an email has an account. */
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user?.active) return;
  await prisma.$transaction(async tx => {
    const url = setPasswordUrl(await createToken(tx, user.id, 'PASSWORD_RESET', 1));
    await notify(tx, { email: user.email }, T.passwordReset(user.name, url));
  });
}

/** Sets a password from an invite or reset link. Ends every existing session of the user. */
export async function setPassword(token: string, password: string) {
  const row = await prisma.userToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.active) throw badRequest('This link has expired or was already used. Ask for a new one.');
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.userToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return { email: row.user.email };
}

export async function changePassword(user: AuthUser, current: string, next: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.passwordHash || !(await verifyPassword(u.passwordHash, current))) throw badRequest('Your current password is incorrect.');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
}

/* ================= STAFF MANAGEMENT ================= */

export async function listStaff() {
  const users = await prisma.user.findMany({ where: { role: { not: 'MEMBER' } }, orderBy: { name: 'asc' } });
  return users.map(u => ({
    id: u.id, email: u.email, name: u.name, title: u.title, role: u.role, roleLabel: ROLE_LABEL[u.role], active: u.active,
    invitePending: !u.passwordHash, lastLoginAt: u.lastLoginAt,
  }));
}

export async function updateStaff(actor: Actor & { id: string }, id: string, data: { role?: Role; title?: string | null; active?: boolean; name?: string }) {
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || u.role === 'MEMBER') throw notFound('Staff user');
  if (data.role === 'MEMBER') throw badRequest('Staff cannot be turned into member accounts.');
  if (id === actor.id && (data.active === false || (data.role && data.role !== 'ADMIN'))) throw badRequest('You cannot deactivate yourself or remove your own admin role.');
  const losingAdmin = u.role === 'ADMIN' && (data.active === false || (data.role && data.role !== 'ADMIN'));
  if (losingAdmin && (await prisma.user.count({ where: { role: 'ADMIN', active: true } })) <= 1) throw conflict('There must be at least one active Secretariat Admin.');
  return prisma.$transaction(async tx => {
    const updated = await tx.user.update({ where: { id }, data });
    if (data.active === false) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    const changes = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(' · ');
    await audit(tx, actor, 'Staff', 'Staff account updated', `${u.email} · ${changes}`);
    return updated;
  });
}

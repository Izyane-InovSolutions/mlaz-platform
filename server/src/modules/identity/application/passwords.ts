import type { TokenPurpose } from '../../../generated/prisma/client.js';
import { config } from '../../../config.js';
import { type Db, prisma } from '../../../shared/db.js';
import { badRequest, conflict, notFound } from '../../../shared/errors.js';
import { randomToken, sha256 } from '../../../shared/tokens.js';
import { audit } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { type Role, isStaffRole } from '../domain/roles.js';
import { LIMITS, addressKey, sourceKey } from '../domain/throttle-policy.js';
import { type AuthUser, actorFor, checkPasswordForUser, isAllowedStaffEmail } from '../domain/users.js';
import { hashPassword, verifyPassword } from '../infrastructure/password-hasher.js';
import { clearPasswordFailures } from '../infrastructure/throttle-store.js';
import { accountMessages } from './messages.js';
import { endAllSessions, issueSession } from './sessions.js';
import { consume, passwordAccepted, sentLastHour } from './throttling.js';

// Invitations, password reset links and password changes.

async function createToken(db: Db, userId: string, purpose: TokenPurpose, ttlHours: number) {
  // Only the newest link of each kind works.
  await db.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken();
  await db.userToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlHours * 3600e3) } });
  return token;
}
const setPasswordUrl = (token: string) => `${config.PUBLIC_APP_URL}/#/set-password?token=${token}`;

interface NewUser { email: string; name: string; role: Role; title?: string | null; memberId?: string | null }

/** Creates a user with no password and returns the link that lets them set one. */
export async function inviteUser(db: Db, data: NewUser) {
  const email = data.email.toLowerCase();
  if (!isAllowedStaffEmail(email, data.role, config.STAFF_EMAIL_DOMAIN)) throw badRequest(`Staff accounts must use an @${config.STAFF_EMAIL_DOMAIN.toLowerCase().replace(/^@/, '')} email address.`);
  if (await db.user.findUnique({ where: { email } })) throw conflict(`An account already exists for ${email}.`, 'EMAIL_TAKEN');
  const user = await db.user.create({ data: { email, name: data.name, role: data.role, title: data.title ?? null, memberId: data.memberId ?? null } });
  const url = setPasswordUrl(await createToken(db, user.id, 'INVITE', 24 * 7));
  return { user, url };
}

export async function sendInvite(db: Db, data: NewUser) {
  const { user, url } = await inviteUser(db, data);
  await notify(db, { email: user.email }, accountMessages.invite(user.name, url, isStaffRole(user.role)));
  return user;
}

/** True when an account already uses this email (any case). */
export const emailTaken = async (db: Db, email: string) => !!(await db.user.findUnique({ where: { email: email.toLowerCase() } }));

export async function resendInvite(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User');
  if (user.passwordHash) throw conflict('This user has already set a password.');
  if (!user.active) throw conflict('This account is deactivated.');
  await prisma.$transaction(async tx => {
    const url = setPasswordUrl(await createToken(tx, user.id, 'INVITE', 24 * 7));
    await notify(tx, { email: user.email }, accountMessages.invite(user.name, url, isStaffRole(user.role)));
  });
}

// Unknown emails return at once and known ones write a token first; answering no sooner than this hides the difference.
export const RESET_MIN_MS = 400;

/** Always succeeds, and in the same time either way, so the response does not reveal whether an email has an account. */
export async function requestPasswordReset(email: string) {
  const started = Date.now();
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user?.active) return;
    // Over the cap nothing is sent and the last link keeps working; the answer is the same, so it reveals nothing.
    if (await sentLastHour(user.id, 'PASSWORD_RESET') >= LIMITS.resetEmails) return;
    await prisma.$transaction(async tx => {
      const url = setPasswordUrl(await createToken(tx, user.id, 'PASSWORD_RESET', 1));
      await notify(tx, { email: user.email }, accountMessages.passwordReset(user.name, url));
    });
  } finally {
    const wait = RESET_MIN_MS - (Date.now() - started);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
}

/** Sets a password from an invite or reset link, and ends every existing session of the user. */
export async function setPassword(token: string, password: string, ip: string) {
  const row = await prisma.userToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.active) throw badRequest('This link has expired or was already used. Ask for a new one.');
  if (!checkPasswordForUser(password, row.user.email)) throw badRequest('Your password must not contain your email name.');
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async tx => {
    // Single use: claim the token atomically, then burn any other outstanding links.
    const claimed = await tx.userToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw badRequest('This link has expired or was already used. Ask for a new one.');
    await tx.userToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await endAllSessions(row.userId, tx);
    await audit(tx, actorFor(row.user, ip), 'Accounts', row.purpose === 'INVITE' ? 'Account activated' : 'Password reset');
  });
  await clearPasswordFailures(row.user.email);
  return { email: row.user.email };
}

/** Changes the password, ends every other session and returns a fresh one for this device. */
export async function changePassword(user: AuthUser, current: string, next: string, remember: boolean, ip: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  // Throttled like sign-in: a stolen session must not become a way to guess the password.
  await consume(addressKey(ip), LIMITS.address);
  await consume(sourceKey(u.email, ip), LIMITS.source);
  if (!u.passwordHash || !(await verifyPassword(u.passwordHash, current))) throw badRequest('Your current password is incorrect.');
  await passwordAccepted(u.email, ip, null);
  if (current === next) throw badRequest('Choose a password different from your current one.');
  if (!checkPasswordForUser(next, u.email)) throw badRequest('Your password must not contain your email name.');
  const passwordHash = await hashPassword(next);
  // The new password and the end of every old session commit together: never one without the other.
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: u.id }, data: { passwordHash } });
    await endAllSessions(u.id, tx);
    await audit(tx, actorFor(u, ip), 'Accounts', 'Password changed', 'All other sessions signed out');
  });
  return issueSession(await prisma.user.findUniqueOrThrow({ where: { id: u.id } }), remember);
}

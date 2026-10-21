import type { Role, TokenPurpose, User } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { type Actor, audit } from '../lib/audit.js';
import { type AuthUser, checkPasswordForUser, hashPassword, signAccessToken, signMfaToken, staffLabel, verifyMfaToken, verifyPassword } from '../lib/auth.js';
import { decrypt, encrypt, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../lib/crypto.js';
import { type Db, prisma } from '../lib/db.js';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { ROLE_LABEL, isStaffRole, permissionsFor } from '../lib/rbac.js';
import { randomToken, sha256 } from '../lib/tokens.js';
import { T, notify } from './notifications.js';

const SESSION_ENDED = 'Your session has ended. Sign in again.';
const actorOfUser = (u: Pick<User, 'id' | 'name' | 'title' | 'role'>, ip?: string): Actor =>
  isStaffRole(u.role) ? { type: 'STAFF', id: u.id, label: staffLabel(u), ip } : { type: 'MEMBER', id: u.id, label: `${u.name} (member)`, ip };

// Verifying against a throwaway hash when the email is unknown keeps the response time the same either way.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashPassword(randomToken()));

/* ================= BRUTE-FORCE PROTECTION ================= */

// 5 failures within 15 minutes locks the key for 15 minutes. Keys are hashed emails (or a user id for 2FA codes),
// so an unknown email locks exactly like a real one and a lockout reveals nothing.
const MAX_FAILURES = 5, WINDOW_MINUTES = 15, LOCK_MINUTES = 15;

async function assertNotLocked(key: string) {
  const t = await prisma.loginThrottle.findUnique({ where: { key } });
  if (t?.lockedUntil && t.lockedUntil > new Date()) {
    const minutes = Math.ceil((t.lockedUntil.getTime() - Date.now()) / 60e3);
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
}

async function recordFailure(key: string) {
  const rows = await prisma.$queryRaw<{ failures: number }[]>`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN now() ELSE "LoginThrottle"."windowStart" END
    RETURNING "failures"`;
  if (rows[0].failures >= MAX_FAILURES) {
    await prisma.loginThrottle.update({ where: { key }, data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60e3), failures: 0, windowStart: new Date() } });
  }
}
const clearFailures = (key: string) => prisma.loginThrottle.deleteMany({ where: { key } });
const emailKey = (email: string) => `email:${sha256(email.toLowerCase())}`;
const mfaKey = (userId: string) => `mfa:${userId}`;

/* ================= SESSIONS ================= */

export async function profile(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, title: true, role: true, totpEnabledAt: true, member: { select: { id: true, number: true, name: true } } },
  });
  return {
    id: u.id, email: u.email, name: u.name, title: u.title, role: u.role, roleLabel: u.title || ROLE_LABEL[u.role],
    permissions: permissionsFor(u.role), member: u.member,
    mfaEnabled: !!u.totpEnabledAt, mfaRequired: config.REQUIRE_STAFF_2FA && isStaffRole(u.role),
  };
}

const needsMfaSetup = (u: Pick<User, 'role' | 'totpEnabledAt'>) => config.REQUIRE_STAFF_2FA && isStaffRole(u.role) && !u.totpEnabledAt;

/** A new session: short-lived access token in the body, refresh token for the httpOnly cookie (set by the route). */
async function issueSession(user: User, remember: boolean) {
  const refreshToken = randomToken(48);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 864e5) },
  });
  const mfaSetup = needsMfaSetup(user);
  return {
    accessToken: signAccessToken(user, { mfaSetup }),
    refreshToken,
    remember,
    expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60,
    mfaSetupRequired: mfaSetup,
    user: await profile(user.id),
  };
}
export type Session = Awaited<ReturnType<typeof issueSession>>;

export async function login(email: string, password: string, portal: 'staff' | 'member' | undefined, remember: boolean, ip: string) {
  const key = emailKey(email);
  await assertNotLocked(key);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : (await verifyPassword(await dummy(), password), false);
  if (!user || !ok || !user.active) {
    await recordFailure(key);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  await clearFailures(key);
  if (portal === 'staff' && !isStaffRole(user.role)) throw forbidden('This account does not have Secretariat access.', 'WRONG_PORTAL');
  if (portal === 'member' && isStaffRole(user.role)) throw forbidden('Secretariat accounts sign in to the Secretariat console.', 'WRONG_PORTAL');
  if (user.totpEnabledAt) return { mfaRequired: true as const, mfaToken: signMfaToken(user.id, remember) };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, actorOfUser(user, ip), 'Accounts', 'Signed in');
  return issueSession(user, remember);
}

/** Second step of sign-in: a code from the authenticator app, or a one-time recovery code. */
export async function completeMfa(mfaToken: string, code: string, ip: string) {
  const t = verifyMfaToken(mfaToken);
  if (!t) throw unauthorized('The sign-in step expired. Enter your email and password again.');
  const key = mfaKey(t.userId);
  await assertNotLocked(key);
  const user = await prisma.user.findUnique({ where: { id: t.userId } });
  if (!user?.active || !user.totpEnabledAt || !user.totpSecret) throw unauthorized(SESSION_ENDED);

  let ok = false, how = 'authenticator code';
  const step = verifyTotp(decrypt(user.totpSecret), code.replace(/\s/g, ''), user.totpLastStep);
  if (step !== null) {
    // Atomic: two requests with the same code cannot both pass.
    const r = await prisma.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    ok = r.count === 1;
  } else {
    const hashed = hashRecoveryCode(code);
    if (user.recoveryCodes.includes(hashed)) {
      const r = await prisma.user.updateMany({ where: { id: user.id, recoveryCodes: { has: hashed } }, data: { recoveryCodes: user.recoveryCodes.filter(h => h !== hashed) } });
      ok = r.count === 1;
      how = `recovery code (${user.recoveryCodes.length - 1} left)`;
    }
  }
  if (!ok) {
    await recordFailure(key);
    throw new AppError(401, 'INVALID_CODE', 'That code is not valid. Check your authenticator app and try again.');
  }
  await clearFailures(key);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, actorOfUser(user, ip), 'Accounts', 'Signed in', `with ${how}`);
  return issueSession(user, t.remember);
}

/**
 * Exchanges a refresh token for a new pair (rotation). Presenting a token that was already rotated means it leaked,
 * so every session of that user is revoked.
 */
export async function refresh(token: string, remember: boolean) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row) throw unauthorized(SESSION_ENDED);
  if (row.revokedAt) {
    // A token that was already exchanged has been copied: end every session. Tokens revoked by sign-out or a
    // password change are simply refused, so a stale token cannot be used to sign the user out of their new session.
    if (row.rotated) await endAllSessions(row.userId);
    throw unauthorized(SESSION_ENDED);
  }
  if (row.expiresAt < new Date() || !row.user.active) throw unauthorized(SESSION_ENDED);
  const revoked = await prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date(), rotated: true } });
  if (!revoked.count) {
    // Lost a race with another use of the same token: the same theft signal.
    await endAllSessions(row.userId);
    throw unauthorized(SESSION_ENDED);
  }
  return issueSession(row.user, remember);
}

export async function logout(token: string) {
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Revokes every refresh token and invalidates every access token already issued to the user. */
async function endAllSessions(userId: string, db: Db = prisma) {
  await db.user.update({ where: { id: userId }, data: { sessionsValidAfter: new Date() } });
  await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function logoutEverywhere(user: AuthUser, ip: string) {
  await endAllSessions(user.id);
  await audit(prisma, actorOfUser(user, ip), 'Accounts', 'Signed out everywhere');
}

/* ================= INVITES & PASSWORDS ================= */

async function createToken(db: Db, userId: string, purpose: TokenPurpose, ttlHours: number) {
  // Only the newest link of each kind works.
  await db.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken();
  await db.userToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlHours * 3600e3) } });
  return token;
}
const setPasswordUrl = (token: string) => `${config.PUBLIC_APP_URL}/#/set-password?token=${token}`;

function assertStaffEmail(email: string, role: Role) {
  const domain = config.STAFF_EMAIL_DOMAIN.toLowerCase().replace(/^@/, '');
  if (domain && isStaffRole(role) && !email.toLowerCase().endsWith(`@${domain}`)) throw badRequest(`Staff accounts must use an @${domain} email address.`);
}

/** Creates a user with no password and returns the link that lets them set one. */
export async function inviteUser(db: Db, data: { email: string; name: string; role: Role; title?: string | null; memberId?: string | null }) {
  const email = data.email.toLowerCase();
  assertStaffEmail(email, data.role);
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
  if (!user.active) throw conflict('This account is deactivated.');
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
    await audit(tx, actorOfUser(row.user, ip), 'Accounts', row.purpose === 'INVITE' ? 'Account activated' : 'Password reset');
  });
  await clearFailures(emailKey(row.user.email));
  return { email: row.user.email };
}

/** Changes the password, ends every other session and returns a fresh one for this device. */
export async function changePassword(user: AuthUser, current: string, next: string, remember: boolean, ip: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.passwordHash || !(await verifyPassword(u.passwordHash, current))) {
    await recordFailure(emailKey(u.email));
    throw badRequest('Your current password is incorrect.');
  }
  if (current === next) throw badRequest('Choose a password different from your current one.');
  if (!checkPasswordForUser(next, u.email)) throw badRequest('Your password must not contain your email name.');
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(next) } });
  await endAllSessions(u.id);
  await audit(prisma, actorOfUser(u, ip), 'Accounts', 'Password changed', 'All other sessions signed out');
  return issueSession(await prisma.user.findUniqueOrThrow({ where: { id: u.id } }), remember);
}

/* ================= TWO-FACTOR SIGN-IN ================= */

/** Starts enrolment: a new secret is stored (encrypted) but not active until a code from it is confirmed. */
export async function beginMfaSetup(user: AuthUser) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (u.totpEnabledAt) throw conflict('Two-factor sign-in is already on. Turn it off first to enrol a new device.');
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: u.id }, data: { totpSecret: encrypt(secret), totpLastStep: null } });
  return { secret, otpauthUrl: otpauthUrl(secret, u.email) };
}

export async function confirmMfaSetup(user: AuthUser, code: string, ip: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (u.totpEnabledAt) throw conflict('Two-factor sign-in is already on.');
  if (!u.totpSecret) throw badRequest('Start the set-up again.');
  const step = verifyTotp(decrypt(u.totpSecret), code.replace(/\s/g, ''), null);
  if (step === null) throw badRequest('That code is not valid. Check the time on your phone and try again.');
  const { codes, hashes } = newRecoveryCodes();
  await prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes } });
  await audit(prisma, actorOfUser(u, ip), 'Accounts', 'Two-factor sign-in turned on');
  return { recoveryCodes: codes };
}

async function assertSecondFactor(u: User, code: string) {
  const step = u.totpSecret ? verifyTotp(decrypt(u.totpSecret), code.replace(/\s/g, ''), u.totpLastStep) : null;
  if (step === null) throw badRequest('That authenticator code is not valid.');
  await prisma.user.update({ where: { id: u.id }, data: { totpLastStep: step } });
}

export async function disableMfa(user: AuthUser, password: string, code: string, ip: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.totpEnabledAt) throw conflict('Two-factor sign-in is not on.');
  if (needsMfaSetup({ role: u.role, totpEnabledAt: null })) throw forbidden('Two-factor sign-in is required for Secretariat accounts.');
  if (!u.passwordHash || !(await verifyPassword(u.passwordHash, password))) throw badRequest('Your password is incorrect.');
  await assertSecondFactor(u, code);
  await prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: null, totpSecret: null, totpLastStep: null, recoveryCodes: [] } });
  await audit(prisma, actorOfUser(u, ip), 'Accounts', 'Two-factor sign-in turned off');
}

export async function regenerateRecoveryCodes(user: AuthUser, code: string, ip: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.totpEnabledAt) throw conflict('Two-factor sign-in is not on.');
  await assertSecondFactor(u, code);
  const { codes, hashes } = newRecoveryCodes();
  await prisma.user.update({ where: { id: u.id }, data: { recoveryCodes: hashes } });
  await audit(prisma, actorOfUser(u, ip), 'Accounts', 'Recovery codes regenerated');
  return { recoveryCodes: codes };
}

/* ================= STAFF MANAGEMENT ================= */

export async function listStaff() {
  const users = await prisma.user.findMany({ where: { role: { not: 'MEMBER' } }, orderBy: { name: 'asc' } });
  return users.map(u => ({
    id: u.id, email: u.email, name: u.name, title: u.title, role: u.role, roleLabel: ROLE_LABEL[u.role], active: u.active,
    invitePending: !u.passwordHash, mfaEnabled: !!u.totpEnabledAt, lastLoginAt: u.lastLoginAt,
  }));
}

export async function updateStaff(actor: Actor & { id: string }, id: string, data: { role?: Role; title?: string | null; active?: boolean; name?: string; resetMfa?: boolean }) {
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || u.role === 'MEMBER') throw notFound('Staff user');
  if (data.role === 'MEMBER') throw badRequest('Staff cannot be turned into member accounts.');
  if (id === actor.id && (data.active === false || (data.role && data.role !== 'ADMIN') || data.resetMfa)) throw badRequest('You cannot deactivate yourself, remove your own admin role or reset your own two-factor sign-in here.');
  const losingAdmin = u.role === 'ADMIN' && (data.active === false || (data.role && data.role !== 'ADMIN'));
  if (losingAdmin && (await prisma.user.count({ where: { role: 'ADMIN', active: true } })) <= 1) throw conflict('There must be at least one active Secretariat Admin.');
  const { resetMfa, ...fields } = data;
  return prisma.$transaction(async tx => {
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
}

/** Turns a member's portal user on or off (e.g. someone who left the business). */
export async function setMemberUserActive(actor: Actor, memberId: string, userId: string, active: boolean) {
  const u = await prisma.user.findFirst({ where: { id: userId, memberId, role: 'MEMBER' } });
  if (!u) throw notFound('Portal user');
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: u.id }, data: { active } });
    if (!active) await endAllSessions(u.id, tx);
    const m = await tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { number: true } });
    await audit(tx, actor, m.number, active ? 'Portal user reactivated' : 'Portal user deactivated', u.email);
  });
}

import type { Role, TokenPurpose, User } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { randomInt } from 'node:crypto';
import { type Actor, SYSTEM, audit } from '../lib/audit.js';
import { type AuthUser, canonicalEmail, checkPasswordForUser, hashPassword, sessionDeadline, signAccessToken, signMfaToken, staffLabel, verifyMfaToken, verifyPassword } from '../lib/auth.js';
import { decrypt, encrypt, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../lib/crypto.js';
import { type Db, prisma } from '../lib/db.js';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { ROLE_LABEL, isStaffRole, permissionsFor } from '../lib/rbac.js';
import { hmac, randomToken, safeEqual, sha256 } from '../lib/tokens.js';
import { T, notify } from './notifications.js';

const SESSION_ENDED = 'Your session has ended. Sign in again.';
const actorOfUser = (u: Pick<User, 'id' | 'name' | 'title' | 'role'>, ip?: string): Actor =>
  isStaffRole(u.role) ? { type: 'STAFF', id: u.id, label: staffLabel(u), ip } : { type: 'MEMBER', id: u.id, label: `${u.name} (member)`, ip };

// Verifying against a throwaway hash when the email is unknown keeps the response time the same either way.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashPassword(randomToken()));

/* ================= BRUTE-FORCE PROTECTION ================= */

// Password guessing is limited in layers. Every counter lives in Postgres and is updated with one atomic statement, so
// all API instances share the same numbers and parallel requests cannot slip past a limit (attempts are counted
// *before* the password is checked; a success hands its attempt back).
//  - Per address, across all accounts: 50 in 15 minutes (one password sprayed over many emails).
//  - Per account and address: 5 in 15 minutes. From a device that has signed in to the account before (device cookie),
//    the device is counted instead of the address, so someone sharing the user's network cannot block them.
//  - Per account from unrecognised devices, across all addresses: 10 in 15 minutes switch the account to "challenge"
//    for an hour. Nobody is locked out by it: a correct password from an unrecognised device must then be confirmed
//    with a code emailed to the account (or the authenticator app, if enrolled). Recognised devices sign in as usual.
// Blocks are temporary and grow with each repeat within a day (1, 4, 16, then at most 60 minutes). Keys hash the
// canonical email, so an unknown email is throttled exactly like a real one and case or spacing changes do not help.
const WINDOW_MINUTES = 15, CHALLENGE_MINUTES = 60, CODE_MINUTES = 10;
// Emails an account can be sent per hour, whoever asks and from however many addresses: password-reset links and
// sign-in codes. Each new one cancels the previous one, so without a cap a flood would also keep the owner's link dead.
export const LIMITS = { address: 50, source: 5, device: 5, account: 10, code: 5, resetEmails: 3, signInCodes: 5 } as const;
const sentLastHour = (userId: string, purpose: TokenPurpose) =>
  prisma.userToken.count({ where: { userId, purpose, createdAt: { gt: new Date(Date.now() - 3600e3) } } });
const BLOCK_MINUTES = [1, 4, 16, 60];

const tooMany = (until: Date) => {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60e3));
  return new AppError(429, 'TOO_MANY_ATTEMPTS', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
};

/** Counts an attempt against `key`. Returns the block end if the key is (now) blocked, else null. */
async function hit(key: string, max: number): Promise<Date | null> {
  const [row] = await prisma.$queryRaw<{ failures: number; lockedUntil: Date | null }[]>`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE WHEN "LoginThrottle"."lockedUntil" > now() THEN "LoginThrottle"."failures"
        WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."lockedUntil" > now() THEN "LoginThrottle"."windowStart"
        WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN now() ELSE "LoginThrottle"."windowStart" END
    RETURNING "failures", "lockedUntil"`;
  if (row.lockedUntil && row.lockedUntil > new Date()) return row.lockedUntil;
  if (row.failures <= max) return null;
  // Over the limit: block, longer for each repeat within a day. Only the first of several racing requests sets it.
  const [locked] = await prisma.$queryRaw<{ lockedUntil: Date }[]>`
    UPDATE "LoginThrottle" t SET "failures" = 0, "windowStart" = now(), "strikes" = s.n,
      "lockedUntil" = now() + make_interval(mins => (${BLOCK_MINUTES}::int[])[LEAST(s.n, ${BLOCK_MINUTES.length})])
    FROM (SELECT CASE WHEN "lockedUntil" IS NULL OR "lockedUntil" < now() - interval '24 hours' THEN 1 ELSE "strikes" + 1 END AS n
          FROM "LoginThrottle" WHERE "key" = ${key}) s
    WHERE t."key" = ${key} AND (t."lockedUntil" IS NULL OR t."lockedUntil" <= now())
    RETURNING t."lockedUntil"`;
  return locked?.lockedUntil ?? (await prisma.loginThrottle.findUnique({ where: { key } }))?.lockedUntil ?? new Date(Date.now() + 60e3);
}
/** Like hit(), but throws 429 when blocked. */
async function consume(key: string, max: number) {
  const until = await hit(key, max);
  if (until) throw tooMany(until);
}

/**
 * Counts an attempt on an account from an unrecognised device. Never blocks; returns true while the account is in
 * challenge mode. Attempts keep counting during the challenge, so a continuing attack keeps extending it.
 */
async function accountUnderAttack(key: string) {
  const [row] = await prisma.$queryRaw<{ failures: number; lockedUntil: Date | null }[]>`
    INSERT INTO "LoginThrottle" ("key", "failures", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN 1 ELSE "LoginThrottle"."failures" + 1 END,
      "windowStart" = CASE WHEN "LoginThrottle"."windowStart" < now() - make_interval(mins => ${WINDOW_MINUTES}) THEN now() ELSE "LoginThrottle"."windowStart" END
    RETURNING "failures", "lockedUntil"`;
  if (row.failures > LIMITS.account) {
    await prisma.$executeRaw`UPDATE "LoginThrottle" SET "failures" = 0, "windowStart" = now(),
      "lockedUntil" = now() + make_interval(mins => ${CHALLENGE_MINUTES}) WHERE "key" = ${key}`;
    return { active: true, started: !(row.lockedUntil && row.lockedUntil > new Date()) };
  }
  return { active: !!row.lockedUntil && row.lockedUntil > new Date(), started: false };
}

/** Hands back an attempt that turned out to be legitimate. */
const refund = (keys: string[]) => prisma.$executeRaw`
  UPDATE "LoginThrottle" SET "failures" = GREATEST("failures" - 1, 0) WHERE "key" = ANY(${keys}::text[])`;
const clear = (keys: string[]) => prisma.loginThrottle.deleteMany({ where: { key: { in: keys } } });

const h = (s: string) => sha256(s);
const addressKey = (ip: string) => `ip:${h(ip)}`;
const sourceKey = (email: string, ip: string) => `login:${h(email)}:${h(ip)}`;
const sourcePrefix = (email: string) => `login:${h(email)}:`;
const deviceKey = (nonce: string) => `device:${h(nonce)}`;
const accountKey = (email: string) => `account:${h(email)}`;
const mfaKey = (userId: string) => `mfa:${userId}`;
const codeKey = (challenge: string) => `code:${h(challenge)}`;

/* ---------- recognised devices ---------- */

// After a successful sign-in the browser gets an httpOnly cookie naming the account(s) it has signed in to. It is not a
// credential (the password is still needed); it only exempts that device from the per-account attack measures.
const DEVICE_TTL_DAYS = 180, DEVICE_MAX_ENTRIES = 5;
const deviceSecret = hmac(config.JWT_SECRET, 'mlaz-device-cookie-v1');
const deviceSig = (body: string) => hmac(deviceSecret, body).slice(0, 43);
const emailTag = (email: string) => h(`device:${email}`).slice(0, 24);

/** The device's nonce for this email if the cookie holds a valid, unexpired entry for it. */
export function recognisedDevice(cookie: string | undefined, email: string): string | null {
  if (!cookie || cookie.length > 2000) return null;
  const tag = emailTag(email), now = Math.floor(Date.now() / 1000);
  for (const entry of cookie.split('~').slice(0, DEVICE_MAX_ENTRIES)) {
    const [v, t, nonce, issued, sig] = entry.split('.');
    if (v !== 'v1' || t !== tag || !nonce || !issued || !sig) continue;
    if (!safeEqual(deviceSig(`${t}.${nonce}.${issued}`), sig)) continue;
    if (now - Number(issued) > DEVICE_TTL_DAYS * 86400) continue;
    return nonce;
  }
  return null;
}
/** The cookie value after a successful sign-in: this account first, then up to four others this browser knows. */
export function deviceCookieAfterSignIn(cookie: string | undefined, email: string) {
  const tag = emailTag(email), issued = String(Math.floor(Date.now() / 1000)), nonce = randomToken(16);
  const others = (cookie ?? '').split('~').filter(e => e.startsWith('v1.') && e.split('.')[1] !== tag).slice(0, DEVICE_MAX_ENTRIES - 1);
  return { value: [`v1.${tag}.${nonce}.${issued}.${deviceSig(`${tag}.${nonce}.${issued}`)}`, ...others].join('~'), maxAge: DEVICE_TTL_DAYS * 86400 };
}

/** A password check against the throttles. Throws 429 when blocked; tells the caller whether to ask for a code. */
async function throttlePassword(email: string, ip: string, device: string | null) {
  await consume(addressKey(ip), LIMITS.address);
  // A recognised device that keeps failing loses its exemption for the window, and is treated like any other device.
  if (device && !(await hit(deviceKey(device), LIMITS.device))) return { device, challenge: false };
  await consume(sourceKey(email, ip), LIMITS.source);
  const attack = await accountUnderAttack(accountKey(email));
  return { device: null, challenge: attack.active, challengeStarted: attack.started };
}
async function passwordAccepted(email: string, ip: string, device: string | null) {
  await clear(device ? [deviceKey(device), sourceKey(email, ip)] : [sourceKey(email, ip)]);
  await refund([addressKey(ip), ...(device ? [] : [accountKey(email)])]);
}
/** After a reset link was used (proof of the mailbox): lift every block and the challenge on the account. */
const clearPasswordFailures = (email: string) =>
  prisma.loginThrottle.deleteMany({ where: { OR: [{ key: accountKey(email) }, { key: { startsWith: sourcePrefix(email) } }] } });

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

/* ---------- session lifetime ---------- */

const HOUR = 3600e3;

/**
 * Issues tokens: a new session at sign-in, or (from refresh) the next refresh token of an existing one. The access token
 * goes in the body, the refresh token in the httpOnly cookie (set by the route). The refresh token expires after the
 * idle timeout, but never after the session's absolute deadline.
 */
async function issueSession(user: User, remember: boolean, existing?: { id: string; createdAt: Date; expiresAt: Date }) {
  const now = Date.now();
  const s = existing ?? await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(now + config.SESSION_ABSOLUTE_LIFETIME_HOURS * HOUR) } });
  const deadline = sessionDeadline(s);
  const refreshToken = randomToken(48);
  await prisma.refreshToken.create({
    data: { userId: user.id, sessionId: s.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Math.min(now + config.SESSION_IDLE_TIMEOUT_HOURS * HOUR, deadline.getTime())) },
  });
  const mfaSetup = needsMfaSetup(user);
  return {
    accessToken: signAccessToken(user, { id: s.id, deadline }, { mfaSetup }),
    refreshToken,
    remember,
    expiresIn: Math.max(1, Math.min(config.ACCESS_TOKEN_TTL_MINUTES * 60, Math.floor((deadline.getTime() - now) / 1000))),
    sessionExpiresAt: deadline,
    mfaSetupRequired: mfaSetup,
    user: await profile(user.id),
  };
}
export type Session = Awaited<ReturnType<typeof issueSession>>;

const INVALID = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

/**
 * Password step of sign-in. `deviceCookie` is the browser's recognised-device cookie, if any. Returns a session, or
 * { mfaRequired, mfaToken, method } when a second step is needed: the authenticator app, or a code emailed because the
 * account is under attack and this device is not recognised. Unknown emails get exactly the answers wrong passwords get.
 */
export async function login(email: string, password: string, portal: 'staff' | 'member' | undefined, remember: boolean, ip: string, deviceCookie?: string) {
  email = canonicalEmail(email);
  const t = await throttlePassword(email, ip, recognisedDevice(deviceCookie, email));
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : (await verifyPassword(await dummy(), password), false);
  if (t.challengeStarted) void noteAttack(email); // not awaited: the answer must not take longer for real accounts
  if (!user || !ok || !user.active) throw INVALID();
  await passwordAccepted(email, ip, t.device);
  if (portal === 'staff' && !isStaffRole(user.role)) throw forbidden('This account does not have Secretariat access.', 'WRONG_PORTAL');
  if (portal === 'member' && isStaffRole(user.role)) throw forbidden('Secretariat accounts sign in to the Secretariat console.', 'WRONG_PORTAL');
  if (user.totpEnabledAt) return { mfaRequired: true as const, method: 'totp' as const, mfaToken: signMfaToken(user.id, remember) };
  if (t.challenge) return { mfaRequired: true as const, method: 'email' as const, mfaToken: signMfaToken(user.id, remember, await sendSignInCode(user)) };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, actorOfUser(user, ip), 'Accounts', 'Signed in');
  return issueSession(user, remember);
}

/** Emails a one-time sign-in code and returns the challenge id carried in the mfa token. Only the hash is stored. */
async function sendSignInCode(user: User) {
  // Only someone with the password gets here, but from many addresses they could still flood the owner's inbox.
  if (await sentLastHour(user.id, 'LOGIN_CHALLENGE') >= LIMITS.signInCodes) {
    throw new AppError(429, 'TOO_MANY_CODES', 'Too many sign-in codes have been sent to this account. Use the most recent code, or try again in an hour.');
  }
  const challenge = randomToken(16), code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.$transaction(async tx => {
    await tx.userToken.updateMany({ where: { userId: user.id, purpose: 'LOGIN_CHALLENGE', usedAt: null }, data: { usedAt: new Date() } });
    await tx.userToken.create({ data: { userId: user.id, purpose: 'LOGIN_CHALLENGE', tokenHash: sha256(`${challenge}:${code}`), expiresAt: new Date(Date.now() + CODE_MINUTES * 60e3) } });
    await notify(tx, { email: user.email }, T.signInCode(user.name, code, CODE_MINUTES));
  });
  return challenge;
}

/** Records, for the Secretariat, that an existing account went into challenge mode. Never fails the request. */
async function noteAttack(email: string) {
  try {
    const u = await prisma.user.findUnique({ where: { email }, select: { email: true } });
    if (u) await audit(prisma, SYSTEM, 'Accounts', 'Sign-in protection switched on', `${u.email}: over ${LIMITS.account} failed sign-ins from unrecognised devices in ${WINDOW_MINUTES} minutes; new devices need an emailed code for ${CHALLENGE_MINUTES} minutes`);
  } catch { /* best effort */ }
}

/**
 * Second step of sign-in: a code from the authenticator app or a one-time recovery code, or (for a challenged sign-in)
 * the code that was emailed.
 */
export async function completeMfa(mfaToken: string, code: string, ip: string) {
  const t = verifyMfaToken(mfaToken);
  if (!t) throw unauthorized('The sign-in step expired. Enter your email and password again.');
  if (t.challenge) return completeEmailChallenge(t.userId, t.challenge, t.remember, code, ip);
  await consume(mfaKey(t.userId), LIMITS.code);
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
  if (!ok) throw new AppError(401, 'INVALID_CODE', 'That code is not valid. Check your authenticator app and try again.');
  await clear([mfaKey(user.id)]);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, actorOfUser(user, ip), 'Accounts', 'Signed in', `with ${how}`);
  return issueSession(user, t.remember);
}

/** The emailed code for a challenged sign-in. Five wrong tries burn the code: the password has to be entered again. */
async function completeEmailChallenge(userId: string, challenge: string, remember: boolean, code: string, ip: string) {
  const expired = () => new AppError(401, 'CODE_EXPIRED', 'That sign-in code has expired or was used up. Enter your email and password again for a new one.');
  const burn = () => prisma.userToken.updateMany({ where: { userId, purpose: 'LOGIN_CHALLENGE', usedAt: null }, data: { usedAt: new Date() } });
  if (await hit(codeKey(challenge), LIMITS.code)) { await burn(); throw expired(); }
  const digits = code.replace(/\s/g, '');
  const row = /^\d{6}$/.test(digits) ? await prisma.userToken.findUnique({ where: { tokenHash: sha256(`${challenge}:${digits}`) }, include: { user: true } }) : null;
  if (!row || row.userId !== userId || row.purpose !== 'LOGIN_CHALLENGE') throw new AppError(401, 'INVALID_CODE', 'That code is not valid. Check the email we sent and try again.');
  // Single use, claimed atomically.
  const claimed = await prisma.userToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (!claimed.count || !row.user.active) throw expired();
  await clear([codeKey(challenge)]);
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await audit(prisma, actorOfUser(row.user, ip), 'Accounts', 'Signed in', 'with an emailed code (sign-in protection was on)');
  return issueSession(row.user, remember);
}

/**
 * Exchanges a refresh token for the next one of the same session (rotation). The session's absolute deadline does not
 * move. Presenting a token that was already rotated, or using one twice at the same moment, means it was copied, so
 * every session of the user is revoked.
 */
export async function refresh(token: string, remember: boolean) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true, session: true } });
  if (!row) throw unauthorized(SESSION_ENDED);
  if (row.revokedAt) {
    // A token that was already exchanged has been copied: end every session. Tokens revoked by sign-out or a
    // password change are simply refused, so a stale token cannot be used to sign the user out of their new session.
    if (row.rotated) await endAllSessions(row.userId);
    throw unauthorized(SESSION_ENDED);
  }
  const now = new Date();
  const s = row.session;
  if (!s || s.revokedAt || sessionDeadline(s) <= now || row.expiresAt <= now || !row.user.active) {
    // Idle, past the absolute deadline, signed out, or issued before sessions had one: retire it (not a theft signal).
    await prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
    throw unauthorized(SESSION_ENDED);
  }
  // Only one request can exchange a given token, so parallel refreshes can never fork the session into two chains.
  const claimed = await prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now, rotated: true } });
  if (!claimed.count) {
    await endAllSessions(row.userId);
    throw unauthorized(SESSION_ENDED);
  }
  await prisma.authSession.update({ where: { id: s.id }, data: { lastUsedAt: now } });
  return issueSession(row.user, remember, s);
}

/** Ends the session the token belongs to: its refresh tokens and (via guards.ts) its access tokens. */
export async function logout(token: string) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true, sessionId: true } });
  if (!row) return;
  const now = new Date();
  if (row.sessionId) {
    await prisma.authSession.updateMany({ where: { id: row.sessionId, revokedAt: null }, data: { revokedAt: now } });
    await prisma.refreshToken.updateMany({ where: { sessionId: row.sessionId, revokedAt: null }, data: { revokedAt: now } });
  } else {
    await prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
  }
}

/** Revokes every session and refresh token, and invalidates every access token already issued to the user. */
async function endAllSessions(userId: string, db: Db = prisma) {
  const now = new Date();
  await db.user.update({ where: { id: userId }, data: { sessionsValidAfter: now } });
  await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
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
      await notify(tx, { email: user.email }, T.passwordReset(user.name, url));
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
    await audit(tx, actorOfUser(row.user, ip), 'Accounts', row.purpose === 'INVITE' ? 'Account activated' : 'Password reset');
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

/**
 * Checks an authenticator code for a sensitive change. Throttled like the sign-in code (same key), and the code is
 * claimed atomically, so it cannot be guessed at length or used twice in parallel.
 */
async function assertSecondFactor(u: User, code: string, alreadyCounted = false) {
  const key = mfaKey(u.id);
  if (!alreadyCounted) await consume(key, LIMITS.code);
  const step = u.totpSecret ? verifyTotp(decrypt(u.totpSecret), code.replace(/\s/g, ''), u.totpLastStep) : null;
  const claimed = step !== null
    && (await prisma.user.updateMany({ where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } })).count === 1;
  if (!claimed) throw badRequest('That authenticator code is not valid.');
  await clear([key]);
}

export async function disableMfa(user: AuthUser, password: string, code: string, ip: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.totpEnabledAt) throw conflict('Two-factor sign-in is not on.');
  if (needsMfaSetup({ role: u.role, totpEnabledAt: null })) throw forbidden('Two-factor sign-in is required for Secretariat accounts.');
  // One attempt covers both the password and the code.
  await consume(mfaKey(u.id), LIMITS.code);
  if (!u.passwordHash || !(await verifyPassword(u.passwordHash, password))) throw badRequest('Your password is incorrect.');
  await assertSecondFactor(u, code, true);
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

import type { User } from '../../../generated/prisma/client.js';
import { config } from '../../../config.js';
import { type Tx, prisma } from '../../../shared/db.js';
import { unauthorized } from '../../../shared/errors.js';
import { log } from '../../../shared/log.js';
import { randomToken, sha256 } from '../../../shared/tokens.js';
import { audit } from '../../audit/index.js';
import { ROLE_LABEL, isStaffRole, permissionsFor } from '../domain/roles.js';
import { type AuthUser, actorFor } from '../domain/users.js';
import { signAccessToken } from '../infrastructure/jwt.js';

export const SESSION_ENDED = 'Your session has ended. Sign in again.';
const HOUR = 3600e3;

/**
 * A session's absolute deadline: fixed at sign-in and never moved by refreshing. If the configured lifetime was
 * lowered since, the shorter one applies. Checked on every request (authenticate.ts) and on every refresh (below).
 */
export const sessionDeadline = (s: { createdAt: Date; expiresAt: Date }) =>
  new Date(Math.min(s.expiresAt.getTime(), s.createdAt.getTime() + config.SESSION_ABSOLUTE_LIFETIME_HOURS * 3600e3));

export const needsMfaSetup = (u: Pick<User, 'role' | 'totpEnabledAt'>) => config.REQUIRE_STAFF_2FA && isStaffRole(u.role) && !u.totpEnabledAt;

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

interface SessionRow { id: string; createdAt: Date; expiresAt: Date }

/**
 * Writes a refresh token for a new session (sign-in) or the next one of an existing session (refresh), in `tx`. The
 * refresh token expires after the idle timeout, but never after the session's absolute deadline.
 */
async function writeRefreshToken(tx: Tx, user: User, existing?: SessionRow) {
  const now = Date.now();
  const s = existing ?? await tx.authSession.create({ data: { userId: user.id, expiresAt: new Date(now + config.SESSION_ABSOLUTE_LIFETIME_HOURS * HOUR) } });
  const deadline = sessionDeadline(s);
  const refreshToken = randomToken(48);
  await tx.refreshToken.create({
    data: { userId: user.id, sessionId: s.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Math.min(now + config.SESSION_IDLE_TIMEOUT_HOURS * HOUR, deadline.getTime())) },
  });
  return { session: s, deadline, refreshToken };
}

/** What a sign-in or refresh returns. The access token goes in the body, the refresh token in the httpOnly cookie (set by the route). */
async function sessionResponse(user: User, remember: boolean, written: Awaited<ReturnType<typeof writeRefreshToken>>) {
  const { session, deadline, refreshToken } = written;
  const mfaSetup = needsMfaSetup(user);
  return {
    accessToken: signAccessToken(user, { id: session.id, deadline }, { mfaSetup }),
    refreshToken,
    remember,
    expiresIn: Math.max(1, Math.min(config.ACCESS_TOKEN_TTL_MINUTES * 60, Math.floor((deadline.getTime() - Date.now()) / 1000))),
    sessionExpiresAt: deadline,
    mfaSetupRequired: mfaSetup,
    user: await profile(user.id),
  };
}

/** Starts a session: the session and its first refresh token are written together. */
export async function issueSession(user: User, remember: boolean) {
  return sessionResponse(user, remember, await prisma.$transaction(tx => writeRefreshToken(tx, user)));
}
export type Session = Awaited<ReturnType<typeof issueSession>>;

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
    if (row.rotated) {
      log().error({ event: 'auth.refresh_token_reuse', userId: row.userId }, 'a refresh token was used twice: every session of this user was ended');
      await endAllSessions(row.userId);
    }
    throw unauthorized(SESSION_ENDED);
  }
  const now = new Date();
  const s = row.session;
  if (!s || s.revokedAt || sessionDeadline(s) <= now || row.expiresAt <= now || !row.user.active) {
    // Idle, past the absolute deadline, signed out, or issued before sessions had one: retire it (not a theft signal).
    await prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
    throw unauthorized(SESSION_ENDED);
  }
  // Retiring the old token and writing its successor commit together, so a failure in between can neither leave the
  // session without a usable token nor with two. Only one request can claim a given token (a parallel one waits for
  // the row and then finds it claimed), so parallel refreshes can never fork the session into two chains.
  const written = await prisma.$transaction(async tx => {
    const claimed = await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now, rotated: true } });
    if (!claimed.count) return null;
    await tx.authSession.update({ where: { id: s.id }, data: { lastUsedAt: now } });
    return writeRefreshToken(tx, row.user, s);
  });
  if (!written) {
    log().error({ event: 'auth.refresh_token_reuse', userId: row.userId }, 'a refresh token was claimed twice at once: every session of this user was ended');
    await endAllSessions(row.userId);
    throw unauthorized(SESSION_ENDED);
  }
  return sessionResponse(row.user, remember, written);
}

/** Ends the session the token belongs to: its refresh tokens and (via the session check) its access tokens. */
export async function logout(token: string) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true, sessionId: true } });
  if (!row) return;
  const now = new Date();
  await prisma.$transaction(async tx => {
    if (row.sessionId) {
      await tx.authSession.updateMany({ where: { id: row.sessionId, revokedAt: null }, data: { revokedAt: now } });
      await tx.refreshToken.updateMany({ where: { sessionId: row.sessionId, revokedAt: null }, data: { revokedAt: now } });
    } else {
      await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
    }
  });
}

/**
 * Revokes every session and refresh token, and invalidates every access token already issued to the user. Pass the
 * caller's transaction when the change that requires it (a password reset, a deactivation) is being written.
 */
export async function endAllSessions(userId: string, tx?: Tx) {
  const run = async (db: Tx) => {
    const now = new Date();
    await db.user.update({ where: { id: userId }, data: { sessionsValidAfter: now } });
    await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  };
  if (tx) await run(tx);
  else await prisma.$transaction(run);
}

export async function logoutEverywhere(user: AuthUser, ip: string) {
  await prisma.$transaction(async tx => {
    await endAllSessions(user.id, tx);
    await audit(tx, actorFor(user, ip), 'Accounts', 'Signed out everywhere');
  });
}

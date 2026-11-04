import { prisma } from '../../../shared/db.js';
import { unauthorized } from '../../../shared/errors.js';
import type { AuthUser } from '../domain/users.js';
import { verifyAccessToken } from '../infrastructure/jwt.js';
import { SESSION_ENDED, sessionDeadline } from './sessions.js';

/**
 * Loads the signed-in user from a bearer token. The session and user are re-read on every request, so sign-out,
 * the session's absolute deadline, deactivation, role changes and "sign out everywhere" (sessionsValidAfter) take
 * effect immediately rather than when the access token expires.
 */
export async function userForAccessToken(bearer: string | undefined): Promise<{ user: AuthUser; sessionId: string; mfaSetupPending: boolean }> {
  const token = bearer?.startsWith('Bearer ') ? verifyAccessToken(bearer.slice(7)) : null;
  if (!token) throw unauthorized();
  const session = await prisma.authSession.findUnique({
    where: { id: token.sessionId },
    select: {
      userId: true, createdAt: true, expiresAt: true, revokedAt: true,
      user: { select: { id: true, email: true, name: true, title: true, role: true, memberId: true, active: true, sessionsValidAfter: true } },
    },
  });
  const user = session?.user;
  if (!session || !user || session.userId !== token.userId || session.revokedAt || sessionDeadline(session) <= new Date() || !user.active
    || (user.sessionsValidAfter && token.issuedAt < user.sessionsValidAfter)) throw unauthorized(SESSION_ENDED);
  const { sessionsValidAfter: _, active: __, ...u } = user;
  return { user: u, sessionId: token.sessionId, mfaSetupPending: token.mfaSetup };
}

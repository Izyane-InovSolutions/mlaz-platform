import type { FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { type AuthUser, actorFor, sessionDeadline, verifyAccessToken } from './auth.js';
import { AppError, forbidden, unauthorized } from './errors.js';
import { type Permission, can, isStaffRole } from './rbac.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    mfaSetupPending?: boolean;
  }
}

/**
 * Loads the signed-in user from the bearer token. The session and user are re-read on every request, so sign-out,
 * the session's absolute deadline, deactivation, role changes and "sign out everywhere" (sessionsValidAfter) take
 * effect immediately rather than when the access token expires.
 */
export async function authenticate(req: FastifyRequest) {
  if (req.user) return req.user;
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? verifyAccessToken(header.slice(7)) : null;
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
    || (user.sessionsValidAfter && token.issuedAt < user.sessionsValidAfter)) throw unauthorized('Your session has ended. Sign in again.');
  const { sessionsValidAfter: _, active: __, ...u } = user;
  req.user = u;
  req.mfaSetupPending = token.mfaSetup;
  return u;
}

/** A session that still has to enrol in two-factor sign-in may only use the enrolment endpoints. */
async function authenticateFull(req: FastifyRequest) {
  const u = await authenticate(req);
  if (req.mfaSetupPending) throw new AppError(403, 'MFA_SETUP_REQUIRED', 'Set up two-factor sign-in to continue.');
  return u;
}

export const requireStaff = (permission?: Permission) => async (req: FastifyRequest) => {
  const u = await authenticateFull(req);
  if (!isStaffRole(u.role)) throw forbidden('This is for Secretariat staff only.');
  if (permission && !can(u.role, permission)) throw forbidden();
};

export async function requireMember(req: FastifyRequest) {
  const u = await authenticateFull(req);
  if (u.role !== 'MEMBER' || !u.memberId) throw forbidden('This is for member accounts only.');
}

export const userOf = (req: FastifyRequest) => req.user!;
export const memberIdOf = (req: FastifyRequest) => req.user!.memberId!;
export const actorOf = (req: FastifyRequest) => actorFor(req.user!, req.ip);

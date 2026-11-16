import type { FastifyRequest } from 'fastify';
import { AppError, forbidden } from '../../../shared/errors.js';
import { type Permission, can, isStaffRole } from '../domain/roles.js';
import { type AuthUser, actorFor } from '../domain/users.js';
import { userForAccessToken } from '../application/authenticate.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    sessionId?: string;
    mfaSetupPending?: boolean;
  }
}

/** Loads the signed-in user once per request; the session is checked against the database every time (see authenticate.ts). */
export async function authenticate(req: FastifyRequest) {
  if (req.user) return req.user;
  const { user, sessionId, mfaSetupPending } = await userForAccessToken(req.headers.authorization);
  req.user = user;
  req.sessionId = sessionId;
  req.mfaSetupPending = mfaSetupPending;
  return user;
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
export const sessionIdOf = (req: FastifyRequest) => req.sessionId!;
export const memberIdOf = (req: FastifyRequest) => req.user!.memberId!;
export const actorOf = (req: FastifyRequest) => actorFor(req.user!, req.ip);

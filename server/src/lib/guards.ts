import type { FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { type AuthUser, actorFor, verifyAccessToken } from './auth.js';
import { forbidden, unauthorized } from './errors.js';
import { type Permission, can, isStaffRole } from './rbac.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Loads the signed-in user from the bearer token. The user is re-read on every request so deactivation is immediate. */
export async function authenticate(req: FastifyRequest) {
  if (req.user) return req.user;
  const header = req.headers.authorization;
  const id = header?.startsWith('Bearer ') ? verifyAccessToken(header.slice(7)) : null;
  if (!id) throw unauthorized();
  const user = await prisma.user.findFirst({
    where: { id, active: true },
    select: { id: true, email: true, name: true, title: true, role: true, memberId: true },
  });
  if (!user) throw unauthorized();
  req.user = user;
  return user;
}

export const requireStaff = (permission?: Permission) => async (req: FastifyRequest) => {
  const u = await authenticate(req);
  if (!isStaffRole(u.role)) throw forbidden('This is for Secretariat staff only.');
  if (permission && !can(u.role, permission)) throw forbidden();
};

export async function requireMember(req: FastifyRequest) {
  const u = await authenticate(req);
  if (u.role !== 'MEMBER' || !u.memberId) throw forbidden('This is for member accounts only.');
}

export const userOf = (req: FastifyRequest) => req.user!;
export const memberIdOf = (req: FastifyRequest) => req.user!.memberId!;
export const actorOf = (req: FastifyRequest) => actorFor(req.user!, req.ip);

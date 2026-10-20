import { hash, verify } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Role } from '../generated/prisma/client.js';
import { config } from '../config.js';
import type { Actor } from './audit.js';
import { ROLE_LABEL, isStaffRole } from './rbac.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  title: string | null;
  role: Role;
  memberId: string | null;
}

export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200);

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password).catch(() => false);

const ISSUER = 'mlaz-api';
export const signAccessToken = (u: AuthUser) =>
  jwt.sign({ role: u.role }, config.JWT_SECRET, { subject: u.id, expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60, issuer: ISSUER, algorithm: 'HS256' });

/** Returns the user id from a valid access token, or null. */
export function verifyAccessToken(token: string): string | null {
  try {
    const p = jwt.verify(token, config.JWT_SECRET, { issuer: ISSUER, algorithms: ['HS256'] });
    return typeof p === 'object' && typeof p.sub === 'string' ? p.sub : null;
  } catch {
    return null;
  }
}

export const staffLabel = (u: Pick<AuthUser, 'name' | 'title' | 'role'>) => `${u.name} (${u.title || ROLE_LABEL[u.role]})`;

export function actorFor(u: AuthUser, ip?: string): Actor {
  return isStaffRole(u.role)
    ? { type: 'STAFF', id: u.id, label: staffLabel(u), ip }
    : { type: 'MEMBER', id: u.id, label: `${u.name} (member)`, ip };
}

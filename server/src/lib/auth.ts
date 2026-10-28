import { hash, verify } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Role } from '../generated/prisma/client.js';
import { config } from '../config.js';
import type { Actor } from './audit.js';
import { ROLE_LABEL, isStaffRole } from './rbac.js';

/**
 * A session's absolute deadline: fixed at sign-in and never moved by refreshing. If the configured lifetime was
 * lowered since, the shorter one applies. Checked on every request (guards.ts) and on every refresh (accounts.ts).
 */
export const sessionDeadline = (s: { createdAt: Date; expiresAt: Date }) =>
  new Date(Math.min(s.expiresAt.getTime(), s.createdAt.getTime() + config.SESSION_ABSOLUTE_LIFETIME_HOURS * 3600e3));

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  title: string | null;
  role: Role;
  memberId: string | null;
}

// Common and guessable passwords are refused outright; length does most of the work.
const COMMON = new Set(['password1234', 'password12345', 'qwerty123456', '1234567890', '12345678910', 'iloveyou123', 'welcome1234', 'admin12345', 'letmein1234', 'zambia12345', 'lusaka12345', 'mlaz123456', 'changeme123', 'password@123', 'p@ssw0rd123']);
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200)
  .refine(p => !COMMON.has(p.toLowerCase()), 'That password is too common. Choose another.')
  .refine(p => new Set(p).size >= 5, 'Use a less repetitive password.');

/** Also refuses passwords built from the account's own email name. */
export function checkPasswordForUser(password: string, email: string) {
  const local = email.split('@')[0].toLowerCase();
  return !(local.length >= 4 && password.toLowerCase().includes(local));
}

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password).catch(() => false);

const ISSUER = 'mlaz-api', AUDIENCE = 'mlaz-platform';

/**
 * Short-lived access token for one session (`sid`). It never outlives the session's absolute deadline, and the session
 * is re-checked on every request. `setup` marks a staff session that must enrol in two-factor sign-in first.
 */
// `ims` is the issue time in milliseconds: JWT `iat` has only 1-second precision, too coarse to tell whether a token
// predates "sign out everywhere" issued in the same second.
export function signAccessToken(u: AuthUser, session: { id: string; deadline: Date }, opts: { mfaSetup?: boolean } = {}) {
  const untilDeadline = Math.floor((session.deadline.getTime() - Date.now()) / 1000);
  return jwt.sign({ typ: 'access', role: u.role, sid: session.id, ims: Date.now(), ...(opts.mfaSetup && { setup: true }) }, config.JWT_SECRET,
    { subject: u.id, expiresIn: Math.max(1, Math.min(config.ACCESS_TOKEN_TTL_MINUTES * 60, untilDeadline)), issuer: ISSUER, audience: AUDIENCE, algorithm: 'HS256' });
}

/**
 * Proves the password step passed; only exchangeable for a session together with a second factor: the authenticator
 * app, or (`challenge`) the code emailed for a sign-in from an unrecognised device while the account is under attack.
 */
export const signMfaToken = (userId: string, remember: boolean, challenge?: string) =>
  jwt.sign({ typ: 'mfa', remember, ...(challenge && { cid: challenge }) }, config.JWT_SECRET, { subject: userId, expiresIn: 600, issuer: ISSUER, audience: AUDIENCE, algorithm: 'HS256' });

function verifyToken(token: string, typ: 'access' | 'mfa') {
  try {
    const p = jwt.verify(token, config.JWT_SECRET, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    if (typeof p !== 'object' || p.typ !== typ || typeof p.sub !== 'string' || typeof p.iat !== 'number') return null;
    return p as jwt.JwtPayload & { sub: string; iat: number };
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string) {
  const p = verifyToken(token, 'access');
  // Tokens without a session id predate absolute session lifetimes; they cannot be checked against one, so are refused.
  if (!p || typeof p.sid !== 'string') return null;
  return { userId: p.sub, sessionId: p.sid, issuedAt: new Date(typeof p.ims === 'number' ? p.ims : p.iat * 1000), mfaSetup: p.setup === true };
}
export function verifyMfaToken(token: string) {
  const p = verifyToken(token, 'mfa');
  return p && { userId: p.sub, remember: p.remember === true, challenge: typeof p.cid === 'string' ? p.cid : null };
}

/** The one spelling of an email used for look-ups and throttling, so case, spacing or Unicode forms cannot dodge a limit. */
export const canonicalEmail = (email: string) => email.normalize('NFKC').trim().toLowerCase();

export const staffLabel = (u: Pick<AuthUser, 'name' | 'title' | 'role'>) => `${u.name} (${u.title || ROLE_LABEL[u.role]})`;

export function actorFor(u: AuthUser, ip?: string): Actor {
  return isStaffRole(u.role)
    ? { type: 'STAFF', id: u.id, label: staffLabel(u), ip }
    : { type: 'MEMBER', id: u.id, label: `${u.name} (member)`, ip };
}

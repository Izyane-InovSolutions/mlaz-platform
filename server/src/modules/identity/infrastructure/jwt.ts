import jwt from 'jsonwebtoken';
import { config } from '../../../config.js';
import { randomToken } from '../../../shared/tokens.js';
import { MFA_STEP_MINUTES } from '../domain/throttle-policy.js';
import type { AuthUser } from '../domain/users.js';

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
// Each one carries a random id (jti), so its attempts are counted, and its use recorded, on their own.
export const signMfaToken = (userId: string, remember: boolean, challenge?: string) =>
  jwt.sign({ typ: 'mfa', remember, ...(challenge && { cid: challenge }) }, config.JWT_SECRET,
    { subject: userId, expiresIn: MFA_STEP_MINUTES * 60, jwtid: randomToken(16), issuer: ISSUER, audience: AUDIENCE, algorithm: 'HS256' });

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
  // A token without an id predates per-step counting; it cannot be tracked, so it is refused (the user signs in again).
  return p && typeof p.jti === 'string' ? { userId: p.sub, stepId: p.jti, remember: p.remember === true, challenge: typeof p.cid === 'string' ? p.cid : null } : null;
}

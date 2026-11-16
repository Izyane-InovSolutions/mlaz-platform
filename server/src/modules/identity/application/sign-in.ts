import { randomInt } from 'node:crypto';
import type { User } from '../../../generated/prisma/client.js';
import { SYSTEM } from '../../../shared/actor.js';
import { prisma } from '../../../shared/db.js';
import { AppError, forbidden, unauthorized } from '../../../shared/errors.js';
import { log } from '../../../shared/log.js';
import { randomToken, sha256 } from '../../../shared/tokens.js';
import { audit } from '../../audit/index.js';
import { notify } from '../../communications/index.js';
import { isStaffRole } from '../domain/roles.js';
import { CHALLENGE_MINUTES, CODE_MINUTES, LIMITS, MFA_STEP_MINUTES, WINDOW_MINUTES, codeKey, mfaDeviceKey, mfaKey, mfaStepKey } from '../domain/throttle-policy.js';
import { hashRecoveryCode, verifyTotp } from '../domain/totp.js';
import { actorFor, canonicalEmail } from '../domain/users.js';
import { signMfaToken, verifyMfaToken } from '../infrastructure/jwt.js';
import { hashPassword, verifyPassword } from '../infrastructure/password-hasher.js';
import { decrypt } from '../infrastructure/secret-box.js';
import { burn, claim, clear, hit } from '../infrastructure/throttle-store.js';
import { recognisedDevice } from './devices.js';
import { accountMessages } from './messages.js';
import { SESSION_ENDED, issueSession } from './sessions.js';
import { consume, passwordAccepted, sentLastHour, throttlePassword } from './throttling.js';

// Verifying against a throwaway hash when the email is unknown keeps the response time the same either way.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashPassword(randomToken()));

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
  if (!user || !ok || !user.active) {
    // For monitoring (credential stuffing, brute force). Never the email typed: an unknown one may be someone's password.
    log().warn({ event: 'auth.sign_in_failed', userId: user?.id ?? null, ip, reason: !user ? 'unknown_account' : !ok ? 'wrong_password' : 'inactive' }, 'sign-in failed');
    throw INVALID();
  }
  await passwordAccepted(email, ip, t.device);
  if (portal === 'staff' && !isStaffRole(user.role)) throw forbidden('This account does not have Secretariat access.', 'WRONG_PORTAL');
  if (portal === 'member' && isStaffRole(user.role)) throw forbidden('Secretariat accounts sign in to the Secretariat console.', 'WRONG_PORTAL');
  if (user.totpEnabledAt) return { mfaRequired: true as const, method: 'totp' as const, mfaToken: signMfaToken(user.id, remember) };
  if (t.challenge) return { mfaRequired: true as const, method: 'email' as const, mfaToken: signMfaToken(user.id, remember, await sendSignInCode(user)) };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, actorFor(user, ip), 'Accounts', 'Signed in');
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
    await notify(tx, { email: user.email }, accountMessages.signInCode(user.name, code, CODE_MINUTES));
  });
  return challenge;
}

/** Records, for the Secretariat, that an existing account went into challenge mode. Never fails the request. */
async function noteAttack(email: string) {
  try {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    log().warn({ event: 'auth.challenge_mode_on', userId: u?.id ?? null }, 'sign-in protection switched on after repeated failures');
    if (u) await audit(prisma, SYSTEM, 'Accounts', 'Sign-in protection switched on', `${u.email}: over ${LIMITS.account} failed sign-ins from unrecognised devices in ${WINDOW_MINUTES} minutes; new devices need an emailed code for ${CHALLENGE_MINUTES} minutes`);
  } catch { /* best effort */ }
}

/**
 * Second step of sign-in: a code from the authenticator app or a one-time recovery code, or (for a challenged sign-in)
 * the code that was emailed.
 */
export async function completeMfa(mfaToken: string, code: string, ip: string, deviceCookie?: string) {
  const stepExpired = () => unauthorized('The sign-in step expired. Enter your email and password again.');
  const t = verifyMfaToken(mfaToken);
  if (!t) throw stepExpired();
  if (t.challenge) return completeEmailChallenge(t.userId, t.challenge, t.remember, code, ip);
  // This sign-in step: five tries, then (or once it has succeeded) the password has to be entered again.
  const stepKey = mfaStepKey(t.stepId);
  if (await hit(stepKey, LIMITS.code)) { await burn(stepKey, MFA_STEP_MINUTES); throw stepExpired(); }
  const user = await prisma.user.findUnique({ where: { id: t.userId } });
  if (!user?.active || !user.totpEnabledAt || !user.totpSecret) throw unauthorized(SESSION_ENDED);
  // The account's ceiling across every step: someone with the password can start new steps at will. A device that
  // has signed in before is counted on its own, so guessing from elsewhere cannot lock the owner out.
  const device = recognisedDevice(deviceCookie, user.email);
  const ceilingKey = device ? mfaDeviceKey(device) : mfaKey(user.id);
  await consume(ceilingKey, LIMITS.code);

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
    log().warn({ event: 'auth.mfa_failed', userId: user.id, ip, method: 'totp' }, 'wrong two-factor code');
    throw new AppError(401, 'INVALID_CODE', 'That code is not valid. Check your authenticator app and try again.');
  }
  // A completed step cannot be completed again, not even by a parallel request with another valid code.
  if (!(await claim(stepKey, MFA_STEP_MINUTES))) throw stepExpired();
  await clear([ceilingKey]);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, actorFor(user, ip), 'Accounts', 'Signed in', `with ${how}`);
  return issueSession(user, t.remember);
}

/** The emailed code for a challenged sign-in. Five wrong tries burn the code: the password has to be entered again. */
async function completeEmailChallenge(userId: string, challenge: string, remember: boolean, code: string, ip: string) {
  const expired = () => new AppError(401, 'CODE_EXPIRED', 'That sign-in code has expired or was used up. Enter your email and password again for a new one.');
  const burn = () => prisma.userToken.updateMany({ where: { userId, purpose: 'LOGIN_CHALLENGE', usedAt: null }, data: { usedAt: new Date() } });
  if (await hit(codeKey(challenge), LIMITS.code)) { await burn(); throw expired(); }
  const digits = code.replace(/\s/g, '');
  const row = /^\d{6}$/.test(digits) ? await prisma.userToken.findUnique({ where: { tokenHash: sha256(`${challenge}:${digits}`) }, include: { user: true } }) : null;
  if (!row || row.userId !== userId || row.purpose !== 'LOGIN_CHALLENGE') {
    log().warn({ event: 'auth.mfa_failed', userId, ip, method: 'email' }, 'wrong emailed sign-in code');
    throw new AppError(401, 'INVALID_CODE', 'That code is not valid. Check the email we sent and try again.');
  }
  // Single use, claimed atomically.
  const claimed = await prisma.userToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (!claimed.count || !row.user.active) throw expired();
  await clear([codeKey(challenge)]);
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await audit(prisma, actorFor(row.user, ip), 'Accounts', 'Signed in', 'with an emailed code (sign-in protection was on)');
  return issueSession(row.user, remember);
}

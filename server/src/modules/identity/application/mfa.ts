import type { User } from '../../../generated/prisma/client.js';
import { prisma } from '../../../shared/db.js';
import { badRequest, conflict, forbidden } from '../../../shared/errors.js';
import { audit } from '../../audit/index.js';
import { LIMITS, mfaSessionKey } from '../domain/throttle-policy.js';
import { newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../domain/totp.js';
import { type AuthUser, actorFor } from '../domain/users.js';
import { verifyPassword } from '../infrastructure/password-hasher.js';
import { decrypt, encrypt } from '../infrastructure/secret-box.js';
import { clear } from '../infrastructure/throttle-store.js';
import { needsMfaSetup } from './sessions.js';
import { consume } from './throttling.js';

// Two-factor sign-in (TOTP): enrolment, recovery codes and turning it off.

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
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes } });
    await audit(tx, actorFor(u, ip), 'Accounts', 'Two-factor sign-in turned on');
  });
  return { recoveryCodes: codes };
}

/**
 * Checks an authenticator code for a sensitive change. Throttled per session (so guessing in one session neither
 * blocks the owner's sign-in nor their other sessions), and the code is claimed atomically against the user's last
 * used step, so it cannot be guessed at length, used twice in parallel, or replayed from any session.
 */
async function assertSecondFactor(u: User, code: string, sessionId: string, alreadyCounted = false) {
  const key = mfaSessionKey(sessionId);
  if (!alreadyCounted) await consume(key, LIMITS.code);
  const step = u.totpSecret ? verifyTotp(decrypt(u.totpSecret), code.replace(/\s/g, ''), u.totpLastStep) : null;
  const claimed = step !== null
    && (await prisma.user.updateMany({ where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } })).count === 1;
  if (!claimed) throw badRequest('That authenticator code is not valid.');
  await clear([key]);
}

export async function disableMfa(user: AuthUser, sessionId: string, password: string, code: string, ip: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.totpEnabledAt) throw conflict('Two-factor sign-in is not on.');
  if (needsMfaSetup({ role: u.role, totpEnabledAt: null })) throw forbidden('Two-factor sign-in is required for Secretariat accounts.');
  // One attempt covers both the password and the code.
  await consume(mfaSessionKey(sessionId), LIMITS.code);
  if (!u.passwordHash || !(await verifyPassword(u.passwordHash, password))) throw badRequest('Your password is incorrect.');
  await assertSecondFactor(u, code, sessionId, true);
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: u.id }, data: { totpEnabledAt: null, totpSecret: null, totpLastStep: null, recoveryCodes: [] } });
    await audit(tx, actorFor(u, ip), 'Accounts', 'Two-factor sign-in turned off');
  });
}

export async function regenerateRecoveryCodes(user: AuthUser, sessionId: string, code: string, ip: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.totpEnabledAt) throw conflict('Two-factor sign-in is not on.');
  await assertSecondFactor(u, code, sessionId);
  const { codes, hashes } = newRecoveryCodes();
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: u.id }, data: { recoveryCodes: hashes } });
    await audit(tx, actorFor(u, ip), 'Accounts', 'Recovery codes regenerated');
  });
  return { recoveryCodes: codes };
}

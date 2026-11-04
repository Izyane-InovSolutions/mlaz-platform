import type { TokenPurpose } from '../../../generated/prisma/client.js';
import { prisma } from '../../../shared/db.js';
import { AppError } from '../../../shared/errors.js';
import { log } from '../../../shared/log.js';
import { CHALLENGE_MINUTES, LIMITS, accountKey, addressKey, deviceKey, sourceKey } from '../domain/throttle-policy.js';
import { accountUnderAttack, clear, hit, refund } from '../infrastructure/throttle-store.js';

const tooManyAttempts = (until: Date) => {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60e3));
  return new AppError(429, 'TOO_MANY_ATTEMPTS', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
};

/** Like hit(), but throws 429 when blocked. */
export async function consume(key: string, max: number) {
  const until = await hit(key, max);
  if (until) {
    // Only the kind of throttle (ip, account, mfa-step…), never the key itself.
    log().warn({ event: 'auth.throttled', throttle: key.split(':')[0], until }, 'attempt refused by a throttle');
    throw tooManyAttempts(until);
  }
}

/** A password check against the throttles. Throws 429 when blocked; tells the caller whether to ask for a code. */
export async function throttlePassword(email: string, ip: string, device: string | null) {
  await consume(addressKey(ip), LIMITS.address);
  // A recognised device that keeps failing loses its exemption for the window, and is treated like any other device.
  if (device && !(await hit(deviceKey(device), LIMITS.device))) return { device, challenge: false };
  await consume(sourceKey(email, ip), LIMITS.source);
  const attack = await accountUnderAttack(accountKey(email), CHALLENGE_MINUTES);
  return { device: null, challenge: attack.active, challengeStarted: attack.started };
}

export async function passwordAccepted(email: string, ip: string, device: string | null) {
  await clear(device ? [deviceKey(device), sourceKey(email, ip)] : [sourceKey(email, ip)]);
  await refund([addressKey(ip), ...(device ? [] : [accountKey(email)])]);
}

/** How many emails of one kind (reset links, sign-in codes) an account was sent in the last hour. */
export const sentLastHour = (userId: string, purpose: TokenPurpose) =>
  prisma.userToken.count({ where: { userId, purpose, createdAt: { gt: new Date(Date.now() - 3600e3) } } });

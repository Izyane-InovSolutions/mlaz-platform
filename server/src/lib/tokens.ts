import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The token in an applicant's tracking link. Derived from the reference with a server secret, so it can be re-sent in any
 * later email without storing it, and cannot be guessed from the (sequential) reference alone.
 */
export const trackingToken = (ref: string) => createHmac('sha256', config.JWT_SECRET).update(`track:${ref}`).digest('base64url').slice(0, 32);
export const checkTrackingToken = (ref: string, token: unknown) => typeof token === 'string' && safeEqual(trackingToken(ref), token);
export const trackingUrl = (ref: string) => `${config.PUBLIC_APP_URL}/#/track/${ref}?t=${trackingToken(ref)}`;

/** Strips one-time tokens (set-password, tracking) from text that is stored or logged. */
export const redactSecrets = (text: string) => text.replace(/([?&](?:token|t)=)[\w-]+/g, '$1[redacted]');

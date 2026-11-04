import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Strips one-time tokens (set-password, tracking links, emailed sign-in codes) from text that is stored or logged. */
export const redactSecrets = (text: string) => text
  .replace(/([?&](?:token|t)=)[\w-]+/g, '$1[redacted]')
  .replace(/(sign-in code(?: is)?:?\s*)\d{6}/gi, '$1[redacted]');

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../../../config.js';

// Encryption at rest for two-factor secrets. Changing DATA_ENCRYPTION_KEY disables existing 2FA enrolments.

/** A separate key per purpose, derived from one secret, so one use can never be confused with another. */
const deriveKey = (secret: string, label: string) => Buffer.from(hkdfSync('sha256', secret, 'mlaz-platform', label, 32));

const dataKey = () => deriveKey(config.DATA_ENCRYPTION_KEY, 'data-encryption-v1');

/** AES-256-GCM: confidential and tamper-evident. Output: v1.<iv>.<tag>.<ciphertext>, base64url. */
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), body].map(x => (typeof x === 'string' ? x : x.toString('base64url'))).join('.');
}

export function decrypt(sealed: string) {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Unsupported ciphertext');
  const d = createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

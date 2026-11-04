import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { safeEqual, sha256 } from '../../../shared/tokens.js';

/* ================= TOTP (RFC 6238) ================= */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const STEP_SECONDS = 30;
export const currentStep = (at = Date.now()) => Math.floor(at / 1000 / STEP_SECONDS);

export function totpAt(secretB32: string, step: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

export const newTotpSecret = () => base32(randomBytes(20));

/**
 * Checks a 6-digit code against the current step ±1 (clock drift). Returns the matched step, or null.
 * Callers store the step and reject any code at or before it, so a code works once.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null) {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep();
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (safeEqual(totpAt(secretB32, step), code)) return step;
  }
  return null;
}

export const otpauthUrl = (secretB32: string, account: string) =>
  `otpauth://totp/${encodeURIComponent(`MLAZ:${account}`)}?secret=${secretB32}&issuer=MLAZ&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

/* ================= RECOVERY CODES ================= */

const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)
export function newRecoveryCodes(n = 8) {
  const codes = Array.from({ length: n }, () => Array.from({ length: 10 }, () => RC_ALPHABET[randomInt(RC_ALPHABET.length)]).join('').replace(/(.{5})/, '$1-'));
  return { codes, hashes: codes.map(hashRecoveryCode) };
}
export const hashRecoveryCode = (code: string) => sha256(code.trim().toLowerCase().replace(/[\s-]/g, ''));

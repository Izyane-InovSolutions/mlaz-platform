import { config } from '../../../config.js';
import { hmac, randomToken, safeEqual, sha256 } from '../../../shared/tokens.js';

// After a successful sign-in the browser gets an httpOnly cookie naming the account(s) it has signed in to. It is not a
// credential (the password is still needed); it only exempts that device from the per-account attack measures.
const DEVICE_TTL_DAYS = 180, DEVICE_MAX_ENTRIES = 5;
const deviceSecret = hmac(config.JWT_SECRET, 'mlaz-device-cookie-v1');
const deviceSig = (body: string) => hmac(deviceSecret, body).slice(0, 43);
const emailTag = (email: string) => sha256(`device:${email}`).slice(0, 24);

/** The device's nonce for this email if the cookie holds a valid, unexpired entry for it. */
export function recognisedDevice(cookie: string | undefined, email: string): string | null {
  if (!cookie || cookie.length > 2000) return null;
  const tag = emailTag(email), now = Math.floor(Date.now() / 1000);
  for (const entry of cookie.split('~').slice(0, DEVICE_MAX_ENTRIES)) {
    const [v, t, nonce, issued, sig] = entry.split('.');
    if (v !== 'v1' || t !== tag || !nonce || !issued || !sig) continue;
    if (!safeEqual(deviceSig(`${t}.${nonce}.${issued}`), sig)) continue;
    if (now - Number(issued) > DEVICE_TTL_DAYS * 86400) continue;
    return nonce;
  }
  return null;
}

/** The cookie value after a successful sign-in: this account first, then up to four others this browser knows. */
export function deviceCookieAfterSignIn(cookie: string | undefined, email: string) {
  const tag = emailTag(email), issued = String(Math.floor(Date.now() / 1000)), nonce = randomToken(16);
  const others = (cookie ?? '').split('~').filter(e => e.startsWith('v1.') && e.split('.')[1] !== tag).slice(0, DEVICE_MAX_ENTRIES - 1);
  return { value: [`v1.${tag}.${nonce}.${issued}.${deviceSig(`${tag}.${nonce}.${issued}`)}`, ...others].join('~'), maxAge: DEVICE_TTL_DAYS * 86400 };
}

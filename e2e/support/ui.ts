// Browser steps shared by the specs. Locators are by role, label or visible text, or by the form field's name
// attribute, which is part of the API contract and does not change with styling. (Until November 2026 labels were not
// associated with their fields; older specs still use `field()`.) See docs/E2E_TESTING.md.
import { type Page, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { PASSWORD } from './env.ts';

export const field = (page: Page, name: string) => page.locator(`[name="${name}"]`);

/** Signs in through the sign-in page. portal: 'admin' (Secretariat) or 'member'. Waits for the console or portal. */
export async function signIn(page: Page, portal: 'admin' | 'member', email: string, password = PASSWORD) {
  await page.goto(`/#/login/${portal}`);
  await expect(page.getByRole('heading', { name: portal === 'admin' ? 'Secretariat sign in' : 'Member portal' })).toBeVisible();
  await field(page, 'email').fill(email);
  await field(page, 'password').fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
}

export async function signInAndWait(page: Page, portal: 'admin' | 'member', email: string, password = PASSWORD) {
  await signIn(page, portal, email, password);
  await expect(page).toHaveURL(portal === 'admin' ? /#\/app\/dashboard/ : /#\/app\/overview/);
  await expect(page.getByRole('main')).toBeVisible();
  // The shell is drawn with a spinner first and redrawn when the page's data arrives; anything clicked before that
  // (the user menu, say) would be replaced under the click.
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0);
}

/** Signs out from the user menu in the top bar. */
export async function signOut(page: Page, userName: string | RegExp) {
  await page.getByRole('button', { name: userName }).click();
  // The item's name starts with its icon's glyph (Bootstrap Icons render it as CSS content), hence the pattern.
  await page.getByRole('button', { name: /^\W*Sign out$/ }).click();
  await expect(page).toHaveURL(/#\/$/);
}

/** The sidebar of the console or portal. */
export const sidebar = (page: Page) => page.getByRole('navigation').filter({ has: page.getByRole('link', { name: /Dashboard|Overview/ }) });

/* ---------- TOTP (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), as an authenticator app computes it ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function fromBase32(s: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const totpStep = (at = Date.now()) => Math.floor(at / 30_000);
export function totp(secret: string, step = totpStep()) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', fromBase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * An open dialog, found by its title heading. Dialogs are now also named by their title, so
 * page.getByRole('dialog', { name }) works too (used by 16-accessibility).
 */
export const dialog = (page: Page, title: string | RegExp) =>
  page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) });

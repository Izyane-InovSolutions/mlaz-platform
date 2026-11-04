// Scenario 18: accessibility of the essential workflows. Every page of the public site, the member portal and the
// Secretariat console is checked for unnamed form fields, buttons and links, images without alt text and unnamed
// dialogs; keyboard focus is checked to be visible, to move to the new page's heading, and to come back from a dialog.
// No extra dependency: the checks run in the page (see audit() below).
import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.ts';
import { MEMBERS, STAFF } from '../support/data.ts';
import { signInAndWait } from '../support/ui.ts';

/** Problems on the current page: each names the element, so a failure says exactly what to fix. */
async function audit(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const byIds = (ids: string | null) => (ids ?? '').split(/\s+/).filter(Boolean).map(id => text(document.getElementById(id))).join(' ').trim();
    const nameOf = (el: Element) => (el.getAttribute('aria-label') ?? '').trim() || byIds(el.getAttribute('aria-labelledby'))
      || [...((el as HTMLInputElement).labels ?? [])].map(text).join(' ').trim() || (el.getAttribute('title') ?? '').trim();
    const describe = (el: Element) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 140);
    const problems: string[] = [];
    for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      if (shown(el) && !nameOf(el)) problems.push(`form field without a name: ${describe(el)}`);
    }
    for (const el of document.querySelectorAll('button, a[href], [role=button]')) {
      const imgAlt = [...el.querySelectorAll('img[alt]')].map(i => i.getAttribute('alt')).join(' ').trim();
      if (shown(el) && !(text(el) || nameOf(el) || imgAlt)) problems.push(`button or link without a name: ${describe(el)}`);
    }
    for (const el of document.querySelectorAll('img:not([alt])')) if (shown(el)) problems.push(`image without alt text: ${describe(el)}`);
    // Icon fonts draw their glyph as CSS content, which would be read out as part of a button's or link's name
    // (and would override its title). textContent does not see it, so this is checked separately.
    for (const el of document.querySelectorAll('.bi:not([aria-hidden=true])')) if (shown(el)) problems.push(`icon not hidden from assistive technology: ${describe(el.parentElement ?? el)}`);
    for (const el of document.querySelectorAll('.modal.show')) {
      if (!byIds(el.getAttribute('aria-labelledby'))) problems.push(`dialog without a name: ${describe(el)}`);
    }
    return problems;
  });
}

/** True when the focused element draws a focus indicator (an outline or Bootstrap's focus ring). */
const focusVisible = (page: Page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const s = getComputedStyle(el);
  return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '');
});

test('the public site has no unnamed fields, buttons, links or images', async ({ page }) => {
  for (const path of ['', 'apply', 'login/member', 'login/admin', 'verify', 'directory', 'track']) {
    await page.goto(`/#/${path}`);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main .spinner-border')).toHaveCount(0);
    expect(await audit(page), `#/${path}`).toEqual([]);
  }
});

test('the sign-in form can be used from the keyboard, with a visible focus indicator at every stop', async ({ page }) => {
  await page.goto('/#/login/member');
  await page.getByLabel('Email').focus();
  expect(await focusVisible(page)).toBe(true);
  await page.keyboard.type(MEMBERS.a11yMember.email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  expect(await focusVisible(page)).toBe(true);
});

test('the member portal: every page passes, and moving to a page puts focus on its heading', async ({ page }) => {
  await signInAndWait(page, 'member', MEMBERS.a11yMember.email);
  for (const p of ['overview', 'certificates', 'dues', 'customers', 'events', 'announcements', 'profile']) {
    await page.goto(`/#/app/${p}`);
    await expect(page.locator('main .spinner-border')).toHaveCount(0);
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
    expect(await audit(page), `#/app/${p}`).toEqual([]);
  }
  await page.getByRole('link', { name: /Dues & payments/ }).click();
  await expect(page).toHaveURL(/#\/app\/dues/);
  await expect(page.locator('main :is(h1, h2)').first()).toBeFocused();
  await expect(page.locator('#announcer')).toHaveText(/Dues/);
});

test('the Secretariat console: every page passes; a dialog is named, starts at its first field and gives focus back', async ({ page }) => {
  await signInAndWait(page, 'admin', STAFF.a11yAdmin.email);
  for (const p of ['dashboard', 'reports', 'members', 'applications', 'certificates', 'payments', 'communications', 'events', 'directory', 'settings']) {
    await page.goto(`/#/app/${p}`);
    await expect(page.locator('main .spinner-border')).toHaveCount(0);
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
    expect(await audit(page), `#/app/${p}`).toEqual([]);
  }
  const edit = page.getByRole('button', { name: 'Edit fees' });
  await edit.focus();
  await page.keyboard.press('Enter');
  const fees = page.getByRole('dialog', { name: 'Fees' });
  await expect(fees).toBeVisible();
  await expect(fees.getByLabel('Joining fee (K)')).toBeFocused();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(fees).toBeHidden();
  await expect(edit).toBeFocused();
});

test('a failed action inside a dialog is announced as an alert', async ({ page }) => {
  await signInAndWait(page, 'admin', STAFF.a11yAdmin.email);
  await page.goto('/#/app/settings');
  await page.getByRole('button', { name: 'Edit fees' }).click();
  const fees = page.getByRole('dialog', { name: 'Fees' });
  // The API's answer is replaced, so nothing is saved and no other spec sees a change.
  await page.route('**/api/admin/settings/fees', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Refused for this test.' } }) }));
  await fees.getByRole('button', { name: 'Save' }).click();
  await expect(fees.getByRole('alert')).toHaveText(/Refused for this test\./);
});

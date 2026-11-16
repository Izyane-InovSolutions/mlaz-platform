// Scenario 14: idle and absolute session expiry in the browser. The API has no clock control and the idle timeout is at
// least an hour, so time is moved instead: the session's timestamps are shifted into the past in mlaz_e2e
// (e2e/support/db.ts explains which columns decide each expiry). The browser then has to notice on its own.
import { expect, test } from '../support/test.ts';
import type { APIRequestContext, BrowserContext } from '../support/test.ts';
import { MEMBERS, STAFF } from '../support/data.ts';
import { ageSessionPastAbsoluteLifetime, ageSessionPastIdleTimeout } from '../support/db.ts';
import { API_URL, UI_URL } from '../support/env.ts';
import { sidebar, signInAndWait } from '../support/ui.ts';

const refreshWith = (request: APIRequestContext, cookie: string) =>
  request.post(`${API_URL}/auth/refresh`, { headers: { cookie: `mlaz_rt=${cookie}`, 'x-mlaz-csrf': '1', origin: UI_URL }, data: {} });
const refreshCookie = async (context: BrowserContext) => {
  const rt = (await context.cookies(`${API_URL}/auth/refresh`)).find(c => c.name === 'mlaz_rt');
  expect(rt, 'the refresh cookie').toBeTruthy();
  return rt!.value;
};

test('an idle session ends: the next visit goes to sign-in and the refresh cookie is refused', async ({ page, context, browser, request }) => {
  const m = MEMBERS.expiryMember;
  // Another browser signed in to the same account: idle expiry is per session, not a reason to end the others.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signInAndWait(otherPage, 'member', m.email);

  await signInAndWait(page, 'member', m.email);
  const rt = await refreshCookie(context);
  await ageSessionPastIdleTimeout(rt);

  // After a real idle period the page's short-lived access token is long gone; a reload is the same state. Restoring
  // the session needs the refresh token, which is past its idle deadline.
  const refused = page.waitForResponse(r => r.url().endsWith('/api/auth/refresh'));
  await page.reload();
  expect((await refused).status()).toBe(401);
  await expect(page).toHaveURL(/#\/login\/member/);
  await expect(page.getByRole('heading', { name: 'Member portal' })).toBeVisible();
  await page.goto('/#/app/dues');
  await expect(page).toHaveURL(/#\/login\/member/);
  expect((await refreshWith(request, rt)).status()).toBe(401);

  // The other browser's session was used recently and carries on.
  await otherPage.reload();
  await expect(otherPage).toHaveURL(/#\/app\/overview/);
  await expect(otherPage.getByRole('heading', { name: m.name })).toBeVisible();
  await other.close();
});

test('a session past its absolute lifetime ends at the next action, even with a valid access token', async ({ page, context, request }) => {
  const s = STAFF.expiryOfficer;
  await signInAndWait(page, 'admin', s.email);
  const rt = await refreshCookie(context);
  // Signed in more than SESSION_ABSOLUTE_LIFETIME_HOURS ago and refreshed just now: the page still holds an access
  // token the API would otherwise accept, and the refresh token is within its idle deadline.
  await ageSessionPastAbsoluteLifetime(rt);

  // The next request in the open page is refused (the deadline is checked on every request), so is the refresh the
  // page then tries, and the user lands on the Secretariat sign-in.
  const refused = page.waitForResponse(r => r.url().endsWith('/api/auth/refresh'));
  await sidebar(page).getByRole('link', { name: 'Applications' }).click();
  expect((await refused).status()).toBe(401);
  await expect(page).toHaveURL(/#\/login\/admin/);
  await expect(page.getByRole('heading', { name: 'Secretariat sign in' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#\/login\/admin/);
  expect((await refreshWith(request, rt)).status()).toBe(401);
});

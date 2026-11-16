// Scenario 13: sign-out, and that nothing brings the session back (back button, reload, the old refresh cookie);
// "sign out everywhere" ends the session in another browser at once.
// Idle and absolute session expiry are in 12-session-expiry.spec.ts (time is moved in the database, since waiting
// out a 1-hour minimum is not practical; see docs/E2E_TESTING.md).
import { expect, test } from '../support/test.ts';
import { MEMBERS, STAFF } from '../support/data.ts';
import { API_URL, UI_URL } from '../support/env.ts';
import { dialog, signInAndWait, signOut } from '../support/ui.ts';

const refreshWith = (request: import('@playwright/test').APIRequestContext, cookie: string) =>
  request.post(`${API_URL}/auth/refresh`, { headers: { cookie: `mlaz_rt=${cookie}`, 'x-mlaz-csrf': '1', origin: UI_URL }, data: {} });

test('signing out ends the session for good', async ({ page, context, request }) => {
  await signInAndWait(page, 'admin', STAFF.sessionOfficer.email);
  const rt = (await context.cookies(`${API_URL}/auth/refresh`)).find(c => c.name === 'mlaz_rt');
  expect(rt, 'the refresh cookie is httpOnly and scoped to /api/auth').toMatchObject({ httpOnly: true, path: '/api/auth', sameSite: 'Strict' });

  await signOut(page, new RegExp(STAFF.sessionOfficer.name));
  expect((await context.cookies(`${API_URL}/auth/refresh`)).find(c => c.name === 'mlaz_rt')).toBeUndefined();

  // Back to the console page: the router finds no session and sends the user to sign in.
  await page.goBack();
  await expect(page).toHaveURL(/#\/login\/admin/); // a console page leads back to the staff sign-in, not the member one
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/#\/login\//);
  await page.goto('/#/app/dashboard');
  await expect(page).toHaveURL(/#\/login\//);

  // The refresh token from before the sign-out is dead.
  expect((await refreshWith(request, rt!.value)).status()).toBe(401);
});

test('a session survives a reload until signed out (restored from the cookie)', async ({ page }) => {
  await signInAndWait(page, 'member', MEMBERS.sessionMember.email);
  await page.reload();
  await expect(page).toHaveURL(/#\/app\/overview/);
  await expect(page.getByRole('heading', { name: MEMBERS.sessionMember.name })).toBeVisible();
});

test('"sign out everywhere" ends the sessions in other browsers too', async ({ browser, request }) => {
  const m = MEMBERS.sessionMember;
  const a = await browser.newContext(), b = await browser.newContext();
  const pageA = await a.newPage(), pageB = await b.newPage();
  await signInAndWait(pageA, 'member', m.email);
  await signInAndWait(pageB, 'member', m.email);
  const rtB = (await b.cookies(`${API_URL}/auth/refresh`)).find(c => c.name === 'mlaz_rt')!;

  await pageA.getByRole('link', { name: 'Business profile' }).first().click();
  await pageA.getByRole('button', { name: 'Sign out everywhere' }).click();
  await dialog(pageA, 'Sign out everywhere').getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(pageA).toHaveURL(/#\/login\/member/);

  // B still has its page and an access token in memory; its next request is refused and it is sent to sign in.
  await pageB.getByRole('link', { name: /Dues & payments/ }).click();
  await expect(pageB).toHaveURL(/#\/login\/member/);
  await expect(pageB.getByRole('heading', { name: 'Member portal' })).toBeVisible();
  expect((await refreshWith(request, rtB.value)).status()).toBe(401);
  await a.close(); await b.close();
});

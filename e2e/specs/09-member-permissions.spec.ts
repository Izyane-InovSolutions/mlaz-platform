// Scenario 11: members cannot reach the Secretariat console and cannot see another member's payment.
import { expect, test } from '../support/test.ts';
import { bearer, tokenFor } from '../support/api.ts';
import { MEMBERS } from '../support/data.ts';
import { API_URL } from '../support/env.ts';
import { signIn, signInAndWait, sidebar } from '../support/ui.ts';

const me = MEMBERS.permA, other = MEMBERS.permB;

test('a member is refused at the Secretariat sign-in', async ({ page }) => {
  await signIn(page, 'admin', me.email);
  await expect(page.getByText('This account does not have Secretariat access.')).toBeVisible();
  await expect(page).toHaveURL(/#\/login\/admin/);
});

test('console pages typed into the address bar show the member portal instead', async ({ page }) => {
  await signInAndWait(page, 'member', me.email);
  await expect(sidebar(page).getByRole('link', { name: 'Applications' })).toHaveCount(0);
  await expect(sidebar(page).getByRole('link', { name: /Payments & dues/ })).toHaveCount(0);
  for (const p of ['applications', 'payments', 'settings', 'members']) {
    await page.goto(`/#/app/${p}`);
    await expect(page.getByRole('heading', { name: me.name })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Applications|Payments & dues|Settings|Members/ })).toHaveCount(0);
  }
});

test('the member sees only their own payments', async ({ page, request }) => {
  await signInAndWait(page, 'member', me.email);
  await page.getByRole('link', { name: /Dues & payments/ }).click();
  await expect(page.getByRole('row', { name: new RegExp(me.payment) })).toBeVisible();
  await expect(page.getByText(other.payment)).toHaveCount(0);

  const auth = { headers: bearer(await tokenFor(request, me.email)) };
  expect((await request.get(`${API_URL}/portal/payments/${me.payment}`, auth)).status()).toBe(200);
  // Another member's payment, its receipt, and any console endpoint.
  expect((await request.get(`${API_URL}/portal/payments/${other.payment}`, auth)).status()).toBe(404);
  expect((await request.get(`${API_URL}/portal/payments/${other.payment}/receipt.pdf`, auth)).status()).toBe(404);
  expect((await request.get(`${API_URL}/admin/payments/${other.payment}`, auth)).status()).toBe(403);
  expect((await request.get(`${API_URL}/admin/applications`, auth)).status()).toBe(403);
});

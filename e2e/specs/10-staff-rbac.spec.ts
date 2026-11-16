// Scenario 12: staff RBAC. The Communications Officer has no payments or applications pages (menus hidden, address
// bar falls back, API 403); the Finance Officer cannot approve applications.
import { expect, test } from '../support/test.ts';
import { bearer, submitApplication, tokenFor, uniqueApplicant } from '../support/api.ts';
import { STAFF } from '../support/data.ts';
import { API_URL } from '../support/env.ts';
import { sidebar, signInAndWait } from '../support/ui.ts';

test('the Communications Officer sees only the pages of their role', async ({ page }) => {
  await signInAndWait(page, 'admin', STAFF.comms.email);
  const nav = sidebar(page);
  await expect(nav.getByRole('link', { name: 'Communications' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
  for (const hidden of [/Payments & dues/, /^Applications/]) await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);

  // Typing a forbidden page's address shows the first page the role may open.
  await page.goto('/#/app/payments');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payments & dues' })).toHaveCount(0);
  await page.goto('/#/app/applications');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('the API refuses what the role cannot do', async ({ request }) => {
  const ref = (await submitApplication(request, uniqueApplicant('Rbac'))).ref;
  const comms = { headers: bearer(await tokenFor(request, STAFF.comms.email)) };
  expect((await request.get(`${API_URL}/admin/payments`, comms)).status()).toBe(403);
  expect((await request.get(`${API_URL}/admin/applications`, comms)).status()).toBe(403);
  expect((await request.post(`${API_URL}/admin/applications/${ref}/recommend`, { ...comms, data: { mofExpiry: '2027-12-31', note: 'Looks fine to me.' } })).status()).toBe(403);

  const finance = { headers: bearer(await tokenFor(request, STAFF.finance.email)) };
  expect((await request.get(`${API_URL}/admin/applications`, finance)).status()).toBe(200);
  expect((await request.post(`${API_URL}/admin/applications/${ref}/approve`, { ...finance, data: {} })).status()).toBe(403);
  expect((await request.post(`${API_URL}/admin/staff`, { ...finance, data: { name: 'New Person', email: 'new.person@mlaz.org.zm', role: 'ADMIN' } })).status()).toBe(403);
});

test('the Finance Officer is not offered recommend or approve buttons', async ({ page, request }) => {
  const a = uniqueApplicant('RbacUi');
  const ref = (await submitApplication(request, a)).ref;
  await signInAndWait(page, 'admin', STAFF.finance.email);
  await page.goto(`/#/app/applications/${ref}`);
  await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
  await expect(page.getByText('Awaiting review and a recommendation from a Membership Officer.')).toBeVisible();
  for (const name of ['Recommend approval', 'Approve', 'Reject application']) await expect(page.getByRole('button', { name })).toHaveCount(0);
});

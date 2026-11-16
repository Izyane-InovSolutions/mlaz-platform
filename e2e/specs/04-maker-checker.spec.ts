// Scenario 5: maker-checker. The officer recommends; the same officer cannot approve (UI and API); the admin approves.
import { expect, test } from '../support/test.ts';
import { bearer, submitApplication, tokenFor, uniqueApplicant } from '../support/api.ts';
import { STAFF } from '../support/data.ts';
import { query } from '../support/db.ts';
import { API_URL } from '../support/env.ts';
import { dialog, signInAndWait, signOut } from '../support/ui.ts';

test.describe.serial('maker-checker approval', () => {
  let a: ReturnType<typeof uniqueApplicant>, ref = '';
  test.beforeAll(async ({ request }) => {
    a = uniqueApplicant('Checker');
    ref = (await submitApplication(request, a)).ref;
  });

  test('the officer recommends approval with the MoF expiry date', async ({ page }) => {
    await signInAndWait(page, 'admin', STAFF.officer.email);
    await page.goto(`/#/app/applications/${ref}`);
    await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
    await expect(page.getByText('All documents received')).toBeVisible();
    await page.getByRole('button', { name: 'Recommend approval' }).click();

    const dlg = dialog(page, 'Recommend for approval');
    // The expiry date is required.
    await dlg.getByRole('button', { name: 'Send for approval' }).click();
    await expect(dlg.getByText('Enter the future expiry date shown on the authorization.')).toBeVisible();
    const expiry = new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10);
    await dlg.locator('[name="mofExpiry"]').fill(expiry);
    await dlg.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Sent to a second officer for approval' })).toBeVisible();

    // The maker now sees the maker-checker note and no Approve button.
    await expect(page.getByText(/you made this recommendation, so a different officer/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await signOut(page, new RegExp(STAFF.officer.name));
  });

  test('the same officer cannot approve through the API either', async ({ request }) => {
    const res = await request.post(`${API_URL}/admin/applications/${ref}/approve`, { headers: bearer(await tokenFor(request, STAFF.officer.email)), data: {} });
    expect(res.status()).toBe(403);
    const [row] = await query<{ approved: boolean }>('SELECT "approvedAt" IS NOT NULL AS approved FROM "Application" WHERE ref = $1', [ref]);
    expect(row.approved).toBe(false);
  });

  test('the admin (checker) approves, and the applicant is asked to pay', async ({ page }) => {
    await signInAndWait(page, 'admin', STAFF.admin.email);
    await page.goto(`/#/app/applications/${ref}`);
    await expect(page.getByText(new RegExp(`Recommended by ${STAFF.officer.name}`))).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    const dlg = dialog(page, 'Approve application');
    await dlg.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Approved. Payment link sent to the applicant' })).toBeVisible();
    await expect(page.getByText(/Approved\. Awaiting K/)).toBeVisible();
    const [row] = await query<{ stage: string }>('SELECT stage FROM "Application" WHERE ref = $1', [ref]);
    expect(row.stage).toBe('PAYMENT_PENDING');
  });
});

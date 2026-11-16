// Scenario 10: a member adds a customer loan and runs credit checks: consent required, daily cap
// (CREDIT_CHECKS_PER_DAY=3 in the e2e environment).
import { type Page, expect, test } from '../support/test.ts';
import { bearer, tokenFor } from '../support/api.ts';
import { MEMBERS } from '../support/data.ts';
import { query } from '../support/db.ts';
import { API_URL } from '../support/env.ts';
import { dialog, signInAndWait } from '../support/ui.ts';

const m = MEMBERS.lender;
// The simulated bureau maps each NRC to the same made-up person every time.
const BORROWERS = [['284512/11/1', 'Nalukui Mwale'], ['320871/41/1', 'Kelvin Banda'], ['199230/71/1', 'Inonge Phiri'], ['251176/51/1', 'Mutale Mulenga']];

async function check(page: Page, nrc: string, consent = true) {
  await page.getByLabel('Credit check by NRC number').pressSequentially(nrc.replace(/\D/g, ''));
  await page.getByLabel('Purpose').selectOption('NEW_LOAN');
  if (consent) await page.getByLabel(/The borrower has given written consent/).check();
  await page.getByRole('button', { name: 'Check credit' }).click();
}

test.describe.serial('customers and credit checks', () => {
  test('adds a customer loan to the loan book', async ({ page }) => {
    await signInAndWait(page, 'member', m.email);
    await page.getByRole('link', { name: 'Customers' }).click();
    await page.getByRole('button', { name: 'Add customer loan' }).click();
    const dlg = dialog(page, 'Add customer loan');
    await dlg.locator('[name="borrowerName"]').fill('Nalukui Mwale');
    await dlg.locator('[name="borrowerNrc"]').pressSequentially('284512111');
    await dlg.locator('[name="issuedAt"]').fill(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
    await dlg.locator('[name="amount"]').fill('5000');
    await dlg.locator('[name="balance"]').fill('3000');
    const saved = page.waitForResponse(r => r.url().endsWith('/api/portal/loans') && r.request().method() === 'POST');
    await dlg.getByRole('button', { name: 'Add', exact: true }).click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(201);
    await expect(page.getByRole('status').filter({ hasText: 'Customer loan added' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Nalukui Mwale .*284512\/11\/1/ })).toBeVisible();
  });

  test('a credit check needs the borrower\'s consent', async ({ page, request }) => {
    await signInAndWait(page, 'member', m.email);
    await page.getByRole('link', { name: 'Customers' }).click();
    let sent = false;
    page.on('request', r => { if (r.url().endsWith('/api/portal/credit-checks') && r.method() === 'POST') sent = true; });
    await check(page, BORROWERS[0][0], false);
    await expect(page.getByText(/needs the borrower.s consent/)).toBeVisible();
    expect(sent).toBe(false);

    // The API refuses it too.
    const res = await request.post(`${API_URL}/portal/credit-checks`, { headers: bearer(await tokenFor(request, m.email)), data: { nrc: BORROWERS[0][0], purpose: 'NEW_LOAN', consent: false } });
    expect(res.status()).toBe(400);
    expect(await query('SELECT 1 FROM "CreditCheck" c JOIN "Member" mm ON mm.id = c."memberId" WHERE mm.number = $1', [m.number])).toHaveLength(0);
  });

  test('checks are logged and capped per day', async ({ page }) => {
    await signInAndWait(page, 'member', m.email);
    await page.getByRole('link', { name: 'Customers' }).click();
    for (const [i, [nrc, name]] of BORROWERS.slice(0, 3).entries()) {
      await check(page, nrc);
      await expect(page.getByRole('heading', { name: `Credit report · ${name}` })).toBeVisible();
      await expect(page.getByText(new RegExp(`${2 - i} checks? left today`))).toBeVisible();
    }
    await expect(page.getByRole('row', { name: /284512\/11\/1/ }).first()).toBeVisible();

    await check(page, BORROWERS[3][0]);
    await expect(page.getByRole('alert').filter({ hasText: 'Your daily limit of 3 credit checks has been reached.' })).toBeVisible(); // error toasts are alerts
    const rows = await query('SELECT 1 FROM "CreditCheck" c JOIN "Member" mm ON mm.id = c."memberId" WHERE mm.number = $1', [m.number]);
    expect(rows).toHaveLength(3);
  });
});

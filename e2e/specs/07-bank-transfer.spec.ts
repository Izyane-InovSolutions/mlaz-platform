// Scenario 8: dues by bank transfer with proof of payment; Finance confirms one transfer and rejects another.
import { type Browser, expect, test } from '../support/test.ts';
import { MEMBERS, STAFF } from '../support/data.ts';
import { cloneMember, paymentStatus, query } from '../support/db.ts';
import { FILES } from '../support/files.ts';
import { dialog, field, signInAndWait } from '../support/ui.ts';

/** The member starts a bank transfer and uploads the proof; returns the payment reference. */
async function payByTransfer(browser: Browser, email: string, bankRef: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAndWait(page, 'member', email);
  await page.getByRole('link', { name: /Dues & payments/ }).click();
  await field(page, 'method').selectOption('BANK_TRANSFER');
  await page.getByRole('button', { name: 'Pay K3,000' }).click();
  await expect(page.getByText('Pay K3,000 into this account')).toBeVisible();
  const ref = (await page.getByText(/^PAY-\d+$/).first().textContent())!.trim();

  // The proof is required.
  await page.getByRole('button', { name: 'Submit proof of payment' }).click();
  await expect(page.getByText('Attach your deposit slip or transfer confirmation.')).toBeVisible();
  await field(page, 'bankRef').fill(bankRef);
  await field(page, 'proof').setInputFiles(FILES.pdf);
  await page.getByRole('button', { name: 'Submit proof of payment' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Proof of payment submitted' })).toBeVisible();
  await expect(page.getByText(new RegExp(`received your proof of payment .*bank ref ${bankRef}`))).toBeVisible();
  await context.close();
  return ref;
}

test.describe.serial('bank transfers', () => {
  let confirmRef = '', rejectRef = '';
  // Fresh members (cloned from the fixtures), so parallel or repeated runs never share one.
  let payer: Awaited<ReturnType<typeof cloneMember>>, rejected: Awaited<ReturnType<typeof cloneMember>>;
  test.beforeAll(async () => {
    payer = await cloneMember(MEMBERS.bankConfirm.number, 'BankConfirm', 20);
    rejected = await cloneMember(MEMBERS.bankReject.number, 'BankReject', 20);
  });

  test('members pay by bank transfer and upload proof of payment', async ({ browser }) => {
    confirmRef = await payByTransfer(browser, payer.email, 'FT26E2ECONF1');
    rejectRef = await payByTransfer(browser, rejected.email, 'FT26E2EREJ02');
    expect(await paymentStatus(confirmRef)).toBe('PENDING');
  });

  test('Finance confirms one transfer and rejects the other', async ({ page }) => {
    test.skip(!confirmRef || !rejectRef, 'needs the upload test');
    await signInAndWait(page, 'admin', STAFF.finance.email);
    await page.getByRole('link', { name: /Payments & dues/ }).click();
    await page.getByRole('button', { name: 'Awaiting review' }).click();

    await page.getByRole('row', { name: new RegExp(confirmRef) }).getByRole('button', { name: 'Review PoP' }).click();
    let dlg = dialog(page, `Proof of payment · ${payer.name}`);
    await expect(dlg.getByText('FT26E2ECONF1')).toBeVisible();
    await dlg.getByRole('button', { name: 'Confirm payment' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Payment confirmed. Membership extended and receipt sent' })).toBeVisible();
    await expect.poll(() => paymentStatus(confirmRef)).toBe('SUCCESS');

    await page.getByRole('row', { name: new RegExp(rejectRef) }).getByRole('button', { name: 'Review PoP' }).click();
    dlg = dialog(page, `Proof of payment · ${rejected.name}`);
    await dlg.getByRole('button', { name: 'Reject' }).click();
    const reason = dialog(page, 'Reject proof of payment');
    await reason.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Proof of payment rejected; the payer has been told' })).toBeVisible();
    await expect.poll(() => paymentStatus(rejectRef)).toBe('FAILED');

    // Neither is waiting for review any more.
    await expect(page.getByRole('row', { name: new RegExp(`${confirmRef}|${rejectRef}`) })).toHaveCount(0);
  });

  test('the confirmed member is paid up; the rejected member can pay again', async ({ browser }) => {
    test.skip(!confirmRef || !rejectRef, 'needs the review test');
    const [c] = await query<{ due: number }>('SELECT ("validUntil" - CURRENT_DATE) AS due FROM "Member" WHERE number = $1', [payer.number]);
    expect(c.due).toBeGreaterThan(300);

    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAndWait(page, 'member', rejected.email);
    await page.getByRole('link', { name: /Dues & payments/ }).click();
    await expect(page.getByRole('row', { name: new RegExp(rejectRef) }).getByText('Failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay K3,000' })).toBeVisible();
    await context.close();
  });
});

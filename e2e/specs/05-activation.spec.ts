// Scenarios 6 and 9: an approved applicant pays online (mobile money sandbox), is accredited, downloads the
// certificate, activates the member portal with the emailed set-password link, and the certificate verifies publicly.
import { type Download, expect, test } from '../support/test.ts';
import { readFileSync } from 'node:fs';
import { approve, recommend, submitApplication, uniqueApplicant } from '../support/api.ts';
import { STAFF } from '../support/data.ts';
import { query, setPasswordLink, trackingLink } from '../support/db.ts';
import { dialog, field, signInAndWait } from '../support/ui.ts';

const NEW_PASSWORD = 'Copper-Lantern-4821';

async function expectPdf(download: Download) {
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(readFileSync((await download.path())!).subarray(0, 5).toString()).toBe('%PDF-');
}

test.describe.serial('accreditation and member activation', () => {
  let a: ReturnType<typeof uniqueApplicant>, ref = '', memberNumber = '', serial = '';
  test.beforeAll(async ({ request }) => {
    a = uniqueApplicant('Activate');
    ref = (await submitApplication(request, a)).ref;
    await recommend(request, STAFF.officer.email, ref);
    await approve(request, STAFF.admin.email, ref);
  });

  test('the applicant pays by mobile money and is accredited', async ({ page }) => {
    await page.goto(await trackingLink(a.email));
    await expect(page.getByText('Your MoF authorization has been verified. Complete payment to receive your accreditation.')).toBeVisible();
    await field(page, 'method').selectOption('MTN_MOMO');
    await field(page, 'msisdn').fill('0971234567');
    await page.getByRole('button', { name: /^Pay K/ }).click();

    const dlg = dialog(page, 'Complete payment');
    await expect(dlg.getByText('Payment request sent to 0971234567')).toBeVisible();
    // The sandbox settles on the API's background reconcile job (every 10 s); the dialog polls until then.
    await expect(dlg.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 45_000 });
    await dlg.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByText(/you are now an accredited MLAZ member/)).toBeVisible();
    const [m] = await query<{ number: string; serial: string }>(
      'SELECT m.number, c.serial FROM "Member" m JOIN "Application" a ON a.id = m."applicationId" JOIN "Certificate" c ON c."memberId" = m.id WHERE a.ref = $1', [ref]);
    memberNumber = m.number; serial = m.serial;
    await expect(page.getByText(`Your member number is ${memberNumber}.`)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download certificate' }).click();
    await expectPdf(await download);
  });

  test('the welcome email\'s set-password link activates the portal, once', async ({ page }) => {
    test.skip(!memberNumber, 'needs the payment test');
    const link = await setPasswordLink(a.email);
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
    // The token is taken out of the address bar.
    await expect(page).toHaveURL(/#\/set-password$/);

    // Mismatched confirmation is caught before anything is sent.
    await field(page, 'password').fill(NEW_PASSWORD);
    await field(page, 'confirm').fill(`${NEW_PASSWORD}x`);
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText(/passwords don.t match/)).toBeVisible();

    await field(page, 'confirm').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByRole('heading', { name: 'Password set' })).toBeVisible();
    await expect(page.getByText(a.email)).toBeVisible();

    // The link is single-use.
    await page.goto(link);
    await field(page, 'password').fill('Another-Lantern-9134');
    await field(page, 'confirm').fill('Another-Lantern-9134');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByRole('heading', { name: 'Password set' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send me a new link' })).toBeVisible();

    await signInAndWait(page, 'member', a.email, NEW_PASSWORD);
    await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
    await expect(page.getByText(`Member ${memberNumber}`, { exact: false })).toBeVisible();
  });

  test('the member downloads the certificate, and anyone can verify it', async ({ page }) => {
    test.skip(!serial, 'needs the payment test');
    await signInAndWait(page, 'member', a.email, NEW_PASSWORD);
    await page.getByRole('link', { name: 'Certificates' }).click();
    await expect(page.getByText(serial)).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download certificate (PDF)' }).click();
    await expectPdf(await download);

    // The certificate's QR code opens #/verify/<member number>; the certificate number works too.
    for (const q of [memberNumber, encodeURIComponent(serial)]) {
      await page.goto(`/#/verify/${q}`);
      await expect(page.getByRole('heading', { name: 'Verified: accredited member in good standing' })).toBeVisible();
      await expect(page.getByText(a.name).first()).toBeVisible();
    }
    await page.goto('/#/verify/MLA-0999');
    await expect(page.getByRole('heading', { name: /No MLAZ member found for/ })).toBeVisible();
  });
});

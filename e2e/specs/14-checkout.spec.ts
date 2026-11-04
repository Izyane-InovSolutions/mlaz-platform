// Scenario 16: dues paid by card and by QR code through the checkout dialog, against the sandbox gateway. The card
// payment's secure page is the gateway's (an external https address); the test checks the link the member is given
// but never opens it, and any request to a host other than the local servers is refused, so nothing leaves the machine.
// The sandbox settles every card and QR payment on the API's reconcile tick, as it does mobile money.
import { type Page, expect, test } from '../support/test.ts';
import { MEMBERS } from '../support/data.ts';
import { cloneMember, query } from '../support/db.ts';
import { dialog, field, signInAndWait } from '../support/ui.ts';

const latestDuesPayment = async (number: string) => (await query<{ ref: string; status: string; method: string; providerRef: string }>(
  `SELECT p.ref, p.status, p.method::text, p."providerRef" FROM "Payment" p JOIN "Member" m ON m.id = p."memberId"
   WHERE m.number = $1 ORDER BY p."createdAt" DESC LIMIT 1`, [number]))[0];
const validUntilYear = async (number: string) =>
  Number((await query<{ until: string }>('SELECT "validUntil"::text AS until FROM "Member" WHERE number = $1', [number]))[0].until.slice(0, 4));

test.beforeEach(async ({ context }) => {
  await context.route(url => !['localhost', '127.0.0.1'].includes(url.hostname), route => route.abort('blockedbyclient'));
});

async function startPayment(page: Page, method: 'CARD' | 'IZYANE_QR', hint: RegExp) {
  await page.getByRole('link', { name: /Dues & payments/ }).click();
  await expect(page.getByRole('heading', { name: 'Dues & payments' })).toBeVisible();
  await field(page, 'method').selectOption(method);
  await expect(page.getByText(hint)).toBeVisible();
  await expect(field(page, 'msisdn')).toHaveCount(0); // no phone number for card or QR
  await page.getByRole('button', { name: 'Pay K3,000' }).click();
  return dialog(page, 'Complete payment');
}

test('a member pays dues by card on the gateway\'s secure page', async ({ page }) => {
  const m = await cloneMember(MEMBERS.cardPayer.number, 'Card', 30);
  const year = await validUntilYear(m.number);
  await signInAndWait(page, 'member', m.email);
  const dlg = await startPayment(page, 'CARD', /pay on our card partner’s secure page/);

  await expect(dlg.getByText('Complete your payment on the secure page')).toBeVisible();
  const pending = await latestDuesPayment(m.number);
  expect(pending).toMatchObject({ status: 'PENDING', method: 'CARD' });
  await expect(dlg.getByText(`Reference ${pending.ref}`)).toBeVisible();
  // The card details are typed on the gateway's page, opened in a new tab without access back to MLAZ.
  const secure = dlg.getByRole('link', { name: 'Open secure checkout' });
  await expect(secure).toHaveAttribute('href', new RegExp(`^https://[^/]+/.*${pending.providerRef}$`));
  await expect(secure).toHaveAttribute('target', '_blank');
  await expect(secure).toHaveAttribute('rel', /noopener/);

  await expect(dlg.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 45_000 });
  await expect(dlg.getByText(new RegExp(`Receipt ${pending.ref} has been emailed`))).toBeVisible();
  const download = page.waitForEvent('download');
  await dlg.getByRole('button', { name: 'Download receipt' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await dlg.getByRole('button', { name: 'Done' }).click();

  expect(await latestDuesPayment(m.number)).toMatchObject({ ref: pending.ref, status: 'SUCCESS', method: 'CARD' });
  await expect(page.getByRole('row', { name: new RegExp(pending.ref) }).getByText('Success', { exact: true })).toBeVisible();
  expect(await validUntilYear(m.number)).toBe(year + 1);
});

test('a member pays dues by scanning a QR code', async ({ page }) => {
  const m = await cloneMember(MEMBERS.qrPayer.number, 'Qr', 30);
  const year = await validUntilYear(m.number);
  await signInAndWait(page, 'member', m.email);
  const dlg = await startPayment(page, 'IZYANE_QR', /You’ll be shown a QR code/);

  await expect(dlg.getByText('Scan to pay with iZyane Pay')).toBeVisible();
  // The QR code is drawn in the page (a PNG data URL), which the Content-Security-Policy must allow.
  const qr = dlg.getByRole('img', { name: 'Payment QR code' });
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const pending = await latestDuesPayment(m.number);
  expect(pending).toMatchObject({ status: 'PENDING', method: 'IZYANE_QR' });

  await expect(dlg.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 45_000 });
  await dlg.getByRole('button', { name: 'Done' }).click();
  expect(await latestDuesPayment(m.number)).toMatchObject({ ref: pending.ref, status: 'SUCCESS', method: 'IZYANE_QR' });
  await expect(page.getByRole('row', { name: new RegExp(pending.ref) }).getByText('Success', { exact: true })).toBeVisible();
  expect(await validUntilYear(m.number)).toBe(year + 1);
});

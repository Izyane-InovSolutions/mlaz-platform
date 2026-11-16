// Scenario 7: a member pays annual dues by mobile money (sandbox), and a declined payment (number ending 0000).
import { type Page, expect, test } from '../support/test.ts';
import { MEMBERS } from '../support/data.ts';
import { cloneMember, query } from '../support/db.ts';
import { dialog, field, signInAndWait } from '../support/ui.ts';

async function payByMobile(page: Page, msisdn: string) {
  await page.getByRole('link', { name: /Dues & payments/ }).click();
  await expect(page.getByRole('heading', { name: 'Dues & payments' })).toBeVisible();
  await field(page, 'method').selectOption('MTN_MOMO');
  await field(page, 'msisdn').fill(msisdn);
  await page.getByRole('button', { name: 'Pay K3,000' }).click();
  return dialog(page, 'Complete payment');
}

const latestDuesPayment = async (number: string) => (await query<{ ref: string; status: string; reason: string | null }>(
  'SELECT p.ref, p.status, p."failureReason" AS reason FROM "Payment" p JOIN "Member" m ON m.id = p."memberId" WHERE m.number = $1 ORDER BY p."createdAt" DESC LIMIT 1', [number]))[0];

test('a member pays dues by mobile money and the membership is extended', async ({ page }) => {
  // A fresh member each time (cloned from the fixture), so parallel or repeated runs never share one.
  const m = await cloneMember(MEMBERS.duesOk.number, 'DuesOk', 30);
  const [before] = await query<{ until: string }>('SELECT "validUntil"::text AS until FROM "Member" WHERE number = $1', [m.number]);
  await signInAndWait(page, 'member', m.email);
  const dlg = await payByMobile(page, '0971112233');
  await expect(dlg.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 45_000 });
  await dlg.getByRole('button', { name: 'Done' }).click();

  const p = await latestDuesPayment(m.number);
  expect(p.status).toBe('SUCCESS');
  await expect(page.getByRole('row', { name: new RegExp(p.ref) }).getByText('Success', { exact: true })).toBeVisible();
  await expect(page.getByText(/Your dues are paid until/)).toBeVisible();
  const [after] = await query<{ until: string }>('SELECT "validUntil"::text AS until FROM "Member" WHERE number = $1', [m.number]);
  expect(Number(after.until.slice(0, 4))).toBe(Number(before.until.slice(0, 4)) + 1);
});

test('a declined mobile money payment is reported and the dues stay payable', async ({ page }) => {
  const m = await cloneMember(MEMBERS.duesDeclined.number, 'Declined', 30);
  await signInAndWait(page, 'member', m.email);
  const dlg = await payByMobile(page, '0970000000');
  await expect(dlg.getByRole('heading', { name: 'Payment not completed' })).toBeVisible({ timeout: 45_000 });
  await expect(dlg.getByText(/Declined by the payer/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Done' }).click();

  const p = await latestDuesPayment(m.number);
  expect(p).toMatchObject({ status: 'FAILED', reason: 'Declined by the payer' });
  await expect(page.getByRole('row', { name: new RegExp(p.ref) })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay K3,000' })).toBeVisible();
});

// Scenario 15: the emailed sign-in code. After more than 10 failed sign-ins to an account from unrecognised devices in
// 15 minutes, a correct password from a browser that has not signed in to the account before must be confirmed with a
// code emailed to the account (server/src/modules/identity/application/sign-in.ts, throttling.ts, devices.ts).
// A few failures happen in this browser; the rest "from other addresses" are added to the account's counter in the
// database, because the per-address limit (5) stops one address long before the account limit (10).
import { expect, test } from '../support/test.ts';
import { MEMBERS } from '../support/data.ts';
import { addFailedSignInsFromElsewhere, lastMailId, mailLink, query } from '../support/db.ts';
import { API_URL, PASSWORD } from '../support/env.ts';
import { signIn, signInAndWait, signOut } from '../support/ui.ts';

const m = MEMBERS.challengeMember;

test('under attack, a new device needs the emailed code: a wrong code is refused, the right one signs in', async ({ page, context }) => {
  // Three wrong passwords from this browser (the per-address limit allows five). The sign-in page stays as it is between
  // attempts (same address), so each answer is awaited rather than the message, which is already showing.
  for (let i = 0; i < 3; i++) {
    const refused = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
    await signIn(page, 'member', m.email, `${PASSWORD}-wrong-${i}`);
    expect((await refused).status()).toBe(401);
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  }
  // Eight more from elsewhere: with the next attempt, 12 in the window, over the limit of 10.
  await addFailedSignInsFromElsewhere(m.email, 8);
  const mailBefore = await lastMailId();

  // The right password from this (unrecognised) browser: no session yet, a code is emailed instead.
  const login = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
  await signIn(page, 'member', m.email);
  expect(await (await login).json()).toMatchObject({ mfaRequired: true, method: 'email' });
  await expect(page.getByText(/repeated failed attempts to sign in to this account/)).toBeVisible();
  const codeInput = page.getByLabel('Sign-in code');
  await expect(codeInput).toBeVisible();
  await expect(page).toHaveURL(/#\/login\/member/);
  expect((await context.cookies(`${API_URL}/auth/refresh`)).find(c => c.name === 'mlaz_rt')).toBeUndefined();
  const code = await mailLink(m.email, /sign-in code is (\d{6})/, { afterId: mailBefore });

  // A wrong code: refused, still on the code step.
  await codeInput.fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code is not valid. Check the email we sent and try again.')).toBeVisible();
  await expect(page).toHaveURL(/#\/login\/member/);

  // The emailed code opens the portal and makes this browser a recognised device.
  await codeInput.fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/#\/app\/overview/);
  await expect(page.getByRole('heading', { name: m.name })).toBeVisible();
  expect((await context.cookies(`${API_URL}/auth/login`)).find(c => c.name === 'mlaz_dev')).toMatchObject({ httpOnly: true });

  // The Secretariat can see that protection switched on and how the member got in.
  await expect.poll(async () => (await query<{ action: string }>(
    `SELECT action FROM "AuditLog" WHERE (action = 'Sign-in protection switched on' AND note LIKE $1)
       OR (action = 'Signed in' AND note LIKE '%emailed code%' AND "actorId" = (SELECT id FROM "User" WHERE email = $2))`, [`${m.email}:%`, m.email]))
    .map(a => a.action).sort()).toEqual(expect.arrayContaining(['Sign-in protection switched on', 'Signed in']));

  // The account is still under protection, but this browser is now recognised: the next sign-in needs no code.
  await signOut(page, /Contact challengeMember/);
  const again = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
  await signInAndWait(page, 'member', m.email);
  expect(await (await again).json()).not.toHaveProperty('mfaRequired');
});

// Scenario 4: staff sign-in and two-factor sign-in (TOTP). The test computes the codes from the key the set-up dialog
// shows, like an authenticator app would.
import { expect, test } from '../support/test.ts';
import { STAFF } from '../support/data.ts';
import { query } from '../support/db.ts';
import { API_URL, PASSWORD } from '../support/env.ts';
import { dialog, signIn, signInAndWait, signOut, totp, totpStep } from '../support/ui.ts';

const user = STAFF.mfaAdmin;

test.describe.serial('two-factor sign-in for staff', () => {
  let secret = '', lastStep = 0;

  test('a wrong password is refused', async ({ page }) => {
    await signIn(page, 'admin', user.email, `${PASSWORD}x`);
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    await expect(page).toHaveURL(/#\/login\/admin/);
  });

  test('enrols an authenticator app from the settings page', async ({ page }) => {
    await signInAndWait(page, 'admin', user.email);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Turn on' }).click();

    const dlg = dialog(page, 'Set up two-factor sign-in');
    await expect(dlg.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    secret = (await dlg.getByText(/^Key:/).textContent())!.replace(/^Key:/, '').replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    // A wrong code keeps the dialog open with the server's message.
    const good = totp(secret);
    await dlg.locator('[name="code"]').fill(good === '123456' ? '654321' : '123456');
    await dlg.getByRole('button', { name: 'Turn on' }).click();
    await expect(dlg.getByText(/That code is not valid/)).toBeVisible();

    lastStep = totpStep();
    await dlg.locator('[name="code"]').fill(totp(secret, lastStep));
    await dlg.getByRole('button', { name: 'Turn on' }).click();
    const codes = dialog(page, 'Save your recovery codes');
    await expect(codes).toBeVisible();
    await codes.getByRole('button', { name: /saved them/ }).click();
    await expect(page.getByText('On: a code from your phone is needed at each sign-in')).toBeVisible();
    const [u] = await query<{ on: boolean }>('SELECT "totpEnabledAt" IS NOT NULL AS on FROM "User" WHERE email = $1', [user.email]);
    expect(u.on).toBe(true);
    await signOut(page, new RegExp(user.name));
  });

  test('signing in then asks for a code: a wrong one is refused, the right one opens the console', async ({ page }) => {
    test.skip(!secret, 'needs the enrolment test');
    await signIn(page, 'admin', user.email);
    const code = page.getByLabel('Authentication code');
    await expect(code).toBeVisible();
    await expect(page).toHaveURL(/#\/login\/admin/);

    // Not one of the codes the server accepts right now (previous, current or next step).
    const valid = new Set([-1, 0, 1].map(d => totp(secret, totpStep() + d)));
    let wrong = '000000';
    while (valid.has(wrong)) wrong = String(Number(wrong) + 1).padStart(6, '0');
    await code.fill(wrong);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(/That code is not valid/)).toBeVisible();
    await expect(page).toHaveURL(/#\/login\/admin/);

    // Each code works once: use a step after the one spent on enrolment (the server accepts one step of drift).
    await code.fill(totp(secret, Math.max(lastStep + 1, totpStep())));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/#\/app\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('the second step cannot be skipped through the API', async ({ request }) => {
    test.skip(!secret, 'needs the enrolment test');
    const res = await request.post(`${API_URL}/auth/login`, { data: { email: user.email, password: PASSWORD } });
    const body = await res.json();
    expect(body).toMatchObject({ mfaRequired: true, method: 'totp' });
    expect(body.accessToken).toBeUndefined();
  });
});

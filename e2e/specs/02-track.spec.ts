// Scenario 3: application tracking via the emailed link, a wrong token, and the "email me the link" fallback.
// Each test opens the page in a fresh browser context, i.e. not the browser the applicant used to apply.
import { expect, test } from '../support/test.ts';
import { submitApplication, uniqueApplicant } from '../support/api.ts';
import { mailLink, trackingLink } from '../support/db.ts';
import { field } from '../support/ui.ts';

test.describe('application tracking', () => {
  let a: ReturnType<typeof uniqueApplicant>, ref: string, other: { ref: string; trackingToken: string };
  test.beforeAll(async ({ request }) => {
    a = uniqueApplicant('Track');
    ref = (await submitApplication(request, a)).ref;
    other = await submitApplication(request, uniqueApplicant('Other'));
  });

  test('opens the application from the emailed link and takes the token out of the address bar', async ({ page }) => {
    const link = await trackingLink(a.email);
    await page.goto(link);
    await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
    await expect(page.getByText(ref, { exact: true })).toBeVisible();
    await expect(page.getByText(/is being verified by the Secretariat/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/track/${ref}$`));

    // Remembered in this browser: a reload still opens it, without the token in the URL.
    await page.reload();
    await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
  });

  test('a wrong token, or another application\'s token, does not open the application', async ({ page }) => {
    for (const t of ['x'.repeat(32), other.trackingToken]) {
      const res = page.waitForResponse(r => r.url().includes(`/api/public/applications/${ref}`));
      await page.goto(`/#/track/${ref}?t=${t}`);
      expect((await res).status()).toBe(404);
      await expect(page.getByRole('heading', { name: `We couldn’t open application ${ref}` })).toBeVisible();
      await expect(page.getByRole('heading', { name: a.name })).toHaveCount(0);
    }
  });

  test('without a link, the applicant can have it emailed again', async ({ page }) => {
    const since = new Date(Date.now() - 5000);
    await page.goto(`/#/track/${ref}`);
    await expect(page.getByRole('heading', { name: `Open your tracking link for ${ref}` })).toBeVisible();
    await field(page, 'email').fill(a.email);
    await page.getByRole('button', { name: 'Email me the link' }).click();
    await expect(page.getByText(/the tracking link is on its way/)).toBeVisible();
    const link = await mailLink(a.email, /http:\/\/[^\s]+(\/#\/track\/APP-\d+\?t=[\w-]+)/, { after: since });
    await page.goto(link);
    await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
  });
});

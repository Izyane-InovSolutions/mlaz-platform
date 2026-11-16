// Scenarios 1 and 2: public application submission (multipart, real PDFs) and document upload rules.
import { expect, test } from '../support/test.ts';
import { submitApplication, uniqueApplicant } from '../support/api.ts';
import { query, trackingLink } from '../support/db.ts';
import { FILES } from '../support/files.ts';
import { field } from '../support/ui.ts';

async function fillWizard(page: import('@playwright/test').Page, a: ReturnType<typeof uniqueApplicant>, files: { pacra: typeof FILES.pdf; nrc: typeof FILES.pdf; mof?: typeof FILES.pdf }) {
  await page.goto('/#/apply/Silver');
  await expect(page.getByRole('heading', { name: 'Apply for membership' })).toBeVisible();
  // Step 1: business
  await field(page, 'name').fill(a.name);
  await field(page, 'pacra').fill(a.pacra);
  await field(page, 'tpin').fill(a.tpin);
  await field(page, 'town').fill(a.town);
  await field(page, 'province').selectOption(a.province);
  await field(page, 'address').fill(a.address);
  await page.getByRole('button', { name: /Continue/ }).click();
  // Step 2: contact
  await expect(page.getByRole('heading', { name: 'Contact person' })).toBeVisible();
  await field(page, 'contact').fill(a.contact);
  await field(page, 'position').fill(a.position);
  await field(page, 'phone').fill(a.phone);
  await field(page, 'email').fill(a.email);
  await page.getByRole('button', { name: /Continue/ }).click();
  // Step 3: documents
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await field(page, 'pacraFile').setInputFiles(files.pacra);
  await field(page, 'director').fill(a.director);
  await field(page, 'directorNrc').pressSequentially(a.directorNrc.replace(/\D/g, ''));
  await expect(field(page, 'directorNrc')).toHaveValue(a.directorNrc);
  await field(page, 'nrcFile').setInputFiles(files.nrc);
  if (files.mof) {
    await field(page, 'mofRef').fill(`MoF/ML/2026/${a.tpin.slice(-4)}`);
    await field(page, 'mofFile').setInputFiles(files.mof);
  }
  await page.getByRole('button', { name: /Continue/ }).click();
  // Step 4: review
  await expect(page.getByRole('heading', { name: 'Review and submit' })).toBeVisible();
  await expect(page.getByText(a.name)).toBeVisible();
  await page.getByLabel(/I confirm the information provided is accurate/).check();
}

test.describe('public application', () => {
  test('submits an application with PDF documents and gets a reference and tracking email', async ({ page }) => {
    const a = uniqueApplicant('Apply');
    await fillWizard(page, a, { pacra: FILES.pdf, nrc: FILES.pdf, mof: FILES.pdf });
    const submitted = page.waitForResponse(r => r.url().endsWith('/api/public/applications') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit application' }).click();
    expect((await submitted).status()).toBe(201);

    await expect(page.getByRole('heading', { name: 'Application submitted' })).toBeVisible();
    const ref = (await page.getByText(/^APP-\d+$/).textContent())!.trim();
    const [app] = await query<{ stage: string; docs: number }>(
      'SELECT a.stage, (SELECT count(*)::int FROM "Document" d WHERE d."applicationId" = a.id) AS docs FROM "Application" a WHERE a.ref = $1', [ref]);
    expect(app).toEqual({ stage: 'MOF_REVIEW', docs: 3 });
    // The confirmation email carries the private tracking link.
    expect(await trackingLink(a.email)).toContain(`/#/track/${ref}?t=`);

    // The browser used to apply can open the application without the link.
    await page.getByRole('main').getByRole('link', { name: 'Track application', exact: true }).click();
    await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
  });

  test('keeps the applicant on a step until its required fields are filled', async ({ page }) => {
    await page.goto('/#/apply');
    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByRole('heading', { name: 'Business details' })).toBeVisible();
    await expect(page.getByText('Enter your 12-digit PACRA number.')).toBeVisible();
  });

  test('rejects a document that is not a PDF, JPG or PNG, even with a .pdf name', async ({ page }) => {
    const a = uniqueApplicant('Reject');
    await fillWizard(page, a, { pacra: FILES.fakePdf, nrc: FILES.pdf });
    const submitted = page.waitForResponse(r => r.url().endsWith('/api/public/applications'));
    await page.getByRole('button', { name: 'Submit application' }).click();
    expect((await submitted).status()).toBe(400);
    await expect(page.getByText(/only PDF, JPG or PNG files are accepted/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Application submitted' })).toHaveCount(0);
    expect(await query('SELECT 1 FROM "Application" WHERE "businessName" = $1', [a.name])).toHaveLength(0);
  });
});

test.describe('documents uploaded later from the tracking page', () => {
  test('refuses a text file, then accepts the MoF authorization PDF', async ({ page, request }) => {
    const a = uniqueApplicant('Upload');
    const app = await submitApplication(request, a, { withMof: false });
    expect(app.stage).toBe('DETAILS');
    await page.goto(await trackingLink(a.email));
    await expect(page.getByRole('heading', { name: 'Upload your Ministry of Finance authorization' })).toBeVisible();

    await field(page, 'mofRef').fill('MoF/ML/2026/7777');
    await field(page, 'mofFile').setInputFiles(FILES.text);
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'only PDF, JPG or PNG files are accepted' })).toBeVisible(); // error toasts are alerts

    await field(page, 'mofFile').setInputFiles(FILES.pdf);
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Authorization submitted for verification' })).toBeVisible();
    await expect(page.getByText(/MoF\/ML\/2026\/7777.*is being verified/)).toBeVisible();
    const [row] = await query<{ stage: string }>('SELECT stage FROM "Application" WHERE ref = $1', [app.ref]);
    expect(row.stage).toBe('MOF_REVIEW');
  });
});

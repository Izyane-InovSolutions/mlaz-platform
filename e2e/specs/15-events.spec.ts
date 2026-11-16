// Scenario 17: events. The Communications Officer creates a free and a paid event (published to members as soon as
// they are created); a member registers for both, paying for the paid one by mobile money (sandbox); the registrations
// show on the member's event pages and in the Secretariat's event dialog. Event names are unique per run.
import { type Page, expect, test } from '../support/test.ts';
import { MEMBERS, STAFF } from '../support/data.ts';
import { lastMailId, mailLink, query } from '../support/db.ts';
import { dialog, field, sidebar, signInAndWait } from '../support/ui.ts';

const officer = STAFF.eventsOfficer, member = MEMBERS.eventGoer;
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** The smallest block of the page holding both the event's title and `has` (its card on the events pages). */
const eventCard = (page: Page, name: string, has: ReturnType<Page['getByRole']>) =>
  page.locator('div').filter({ has: page.getByRole('heading', { name, exact: true }) }).filter({ has }).last();

async function createEvent(page: Page, e: { name: string; type: string; venue: string; capacity: number; price: number }) {
  await page.getByRole('button', { name: /New event/ }).click();
  const dlg = dialog(page, 'New event');
  await dlg.locator('[name="name"]').fill(e.name);
  await dlg.locator('[name="date"]').fill(inDays(30));
  await dlg.locator('[name="type"]').selectOption(e.type);
  await dlg.locator('[name="venue"]').fill(e.venue);
  await dlg.locator('[name="capacity"]').fill(String(e.capacity));
  await dlg.locator('[name="price"]').fill(String(e.price));
  await dlg.locator('[name="description"]').fill('Created by the end-to-end tests.');
  await dlg.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event published to members' }).last()).toBeVisible();
  await expect(dlg).toHaveCount(0);
}

test.describe.serial('events', () => {
  const run = `${Date.now() % 1e7}${process.pid % 100}`;
  const free = { name: `E2E Compliance Webinar ${run}`, type: 'WEBINAR', venue: 'Online (Teams)', capacity: 50, price: 0 };
  const paid = { name: `E2E Lending Training ${run}`, type: 'TRAINING', venue: 'Pamodzi Hotel, Lusaka', capacity: 20, price: 250 };

  test('the Communications Officer creates and publishes a free and a paid event', async ({ page }) => {
    await signInAndWait(page, 'admin', officer.email);
    await sidebar(page).getByRole('link', { name: 'Events' }).click();
    await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();

    // A required field missing keeps the dialog open and creates nothing.
    await page.getByRole('button', { name: /New event/ }).click();
    const dlg = dialog(page, 'New event');
    await dlg.getByRole('button', { name: 'Create event' }).click();
    await expect(dlg.getByText('Required.').first()).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);

    await createEvent(page, free);
    await createEvent(page, paid);
    for (const e of [free, paid]) {
      const card = eventCard(page, e.name, page.getByRole('button', { name: 'Manage' }));
      await expect(card.getByText(`0 / ${e.capacity} registered`)).toBeVisible();
      await expect(card.getByText(e.price ? `K${e.price} per ticket` : 'Free', { exact: true })).toBeVisible();
    }
    const rows = await query<{ name: string; status: string; price: string }>('SELECT name, status, price::text FROM "Event" WHERE name IN ($1, $2) ORDER BY price', [free.name, paid.name]);
    expect(rows).toEqual([{ name: free.name, status: 'PUBLISHED', price: '0.00' }, { name: paid.name, status: 'PUBLISHED', price: '250.00' }]);
  });

  test('a member registers for the free event and pays for two tickets to the paid one', async ({ page }) => {
    const mailBefore = await lastMailId();
    await signInAndWait(page, 'member', member.email);
    await sidebar(page).getByRole('link', { name: 'Events' }).click();

    // Free event: one click, confirmed at once, confirmation emailed.
    await eventCard(page, free.name, page.getByRole('link', { name: 'Register', exact: true })).getByRole('link', { name: 'Register', exact: true }).click();
    await expect(page.getByRole('heading', { name: free.name })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Register', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Registered for 1 ticket. A confirmation has been emailed' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your registration' })).toBeVisible();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    await mailLink(member.email, new RegExp(free.name), { afterId: mailBefore });

    // Paid event: two tickets, total shown, paid through the checkout dialog.
    await sidebar(page).getByRole('link', { name: 'Events' }).click();
    await eventCard(page, paid.name, page.getByRole('link', { name: 'Register', exact: true })).getByRole('link', { name: 'Register', exact: true }).click();
    await expect(page.getByRole('heading', { name: paid.name })).toBeVisible();
    await page.getByLabel('Number of tickets').fill('2');
    await expect(page.getByText('K500', { exact: true })).toBeVisible();
    await field(page, 'method').selectOption('MTN_MOMO');
    await field(page, 'msisdn').fill('0971112233');
    await page.getByRole('button', { name: 'Pay and register' }).click();
    const dlg = dialog(page, 'Complete payment');
    await expect(dlg.getByText('Payment request sent to 0971112233')).toBeVisible();
    await expect(dlg.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 45_000 });
    await dlg.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    await expect(page.getByText('2 tickets', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Receipt/ })).toBeVisible();

    // The events list shows both registrations.
    await sidebar(page).getByRole('link', { name: 'Events' }).click();
    await expect(eventCard(page, free.name, page.getByRole('link', { name: /Registered/ })).getByRole('link', { name: /Registered · 1 ticket$/ })).toBeVisible();
    await expect(eventCard(page, paid.name, page.getByRole('link', { name: /Registered/ })).getByRole('link', { name: /Registered · 2 tickets$/ })).toBeVisible();

    const regs = await query<{ event: string; tickets: number; amount: string; status: string; payment: string | null }>(
      `SELECT e.name AS event, r.tickets, r.amount::text, r.status::text, p.status::text AS payment FROM "Registration" r JOIN "Event" e ON e.id = r."eventId"
       JOIN "Member" m ON m.id = r."memberId" LEFT JOIN "Payment" p ON p."registrationId" = r.id WHERE m.number = $1 AND e.name IN ($2, $3) ORDER BY r.amount`,
      [member.number, free.name, paid.name]);
    expect(regs).toEqual([
      { event: free.name, tickets: 1, amount: '0.00', status: 'CONFIRMED', payment: null },
      { event: paid.name, tickets: 2, amount: '500.00', status: 'CONFIRMED', payment: 'SUCCESS' },
    ]);
  });

  test('the Secretariat sees the registrations on each event', async ({ page }) => {
    await signInAndWait(page, 'admin', officer.email);
    await sidebar(page).getByRole('link', { name: 'Events' }).click();
    for (const e of [free, paid]) {
      const tickets = e.price ? 2 : 1;
      const card = eventCard(page, e.name, page.getByRole('button', { name: 'Manage' }));
      await expect(card.getByText(`${tickets} / ${e.capacity} registered`)).toBeVisible();
      await card.getByRole('button', { name: 'Manage' }).click();
      const dlg = dialog(page, e.name);
      const row = dlg.getByRole('row', { name: new RegExp(member.name) });
      await expect(row.getByText('Confirmed', { exact: true })).toBeVisible();
      await expect(row.getByRole('cell', { name: String(tickets), exact: true })).toBeVisible();
      if (e.price) {
        await expect(row.getByText(/PAY-\d+ · success/)).toBeVisible();
        await expect(dlg.getByText('K500', { exact: true }).first()).toBeVisible(); // revenue collected
      } else {
        await expect(row.getByRole('cell', { name: 'Free', exact: true })).toBeVisible();
      }
      await dlg.getByRole('button', { name: 'Close', exact: true }).last().click(); // the footer's (the header's × is also "Close")
      await expect(dlg).toHaveCount(0);
    }
  });
});

// With no SMS gateway and no credit bureau connected (SMS_DRIVER=none, BUREAU_DRIVER=none, as production must run
// until real adapters exist), both features say so instead of pretending to work.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The drivers are chosen when their modules load, and test/setup.ts has already loaded them with the defaults. So this
// file loads its own copy of the application with the drivers off.
process.env.SMS_DRIVER = 'none';
process.env.BUREAU_DRIVER = 'none';
vi.resetModules();
const { notify, processOutbox } = await import('../src/modules/communications/index.js');
const { prisma } = await import('../src/shared/db.js');
(await import('../src/platform/modules.js')).wireModules();
const { STAFF, as, makeMember, resetDb } = await import('./helpers.js');
afterAll(() => prisma.$disconnect());

describe('integrations that are not connected', () => {
  beforeAll(resetDb);

  it('queues no SMS at all, only the email', async () => {
    await notify(prisma, { email: 'a@example.zm', phone: '0971234567' }, { subject: 'Hello', text: 'Email text', sms: 'SMS text' });
    const rows = await prisma.notification.findMany();
    expect(rows.map(r => r.channel)).toEqual(['EMAIL']);
  });

  it('fails an SMS queued before SMS was turned off at once, with the reason, instead of marking it sent', async () => {
    await prisma.notification.deleteMany();
    const n = await prisma.notification.create({ data: { channel: 'SMS', to: '0971234567', subject: '', body: 'queued earlier' } });
    expect(await processOutbox()).toBe(0);
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ status: 'FAILED', attempts: 1, lastError: expect.stringMatching(/SMS_DRIVER=none/) });
  });

  it('refuses credit checks with 503 before using any of the daily allowance', async () => {
    const m = await makeMember();
    const r = await (await as(m.email)).post('/portal/credit-checks', { nrc: '284512/11/1', purpose: 'NEW_LOAN', consent: true });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({ code: 'BUREAU_UNAVAILABLE', message: expect.stringMatching(/not connected a credit bureau/) });
    expect(await prisma.creditCheck.count()).toBe(0);
  });

  it('shows both as not connected in the Secretariat’s settings', async () => {
    const integ = (await (await as(STAFF.admin)).get('/admin/settings')).json().integrations;
    expect(integ.sms).toEqual({ driver: 'none', state: 'off' });
    expect(integ.creditBureau).toEqual({ driver: 'none', state: 'off' });
    expect(integ.tpinLookup.state).toBe('off');
  });
});

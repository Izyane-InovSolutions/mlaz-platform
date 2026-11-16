// Resets the mlaz_e2e database to a known state: empties every table, then adds the configuration and the fixture
// accounts in data.ts. Run by global-setup.ts with the server's tsx (cwd server/), so it uses the API's own Prisma
// client, password hashing and settings defaults, the same way server/test/helpers.ts does.
//
// Emails: with SMTP_URL empty the API writes each email to the Notification outbox, and the outbox job then marks it
// sent and scrubs its one-time links (?token=, ?t=, sign-in codes). The tests need those links, so this script adds a
// trigger to the e2e database only that copies every new Notification row into e2e_mail as it is inserted.
import { hashPassword } from '../../server/src/modules/identity/index.js';
import { SETTING_DEFAULTS, setSetting } from '../../server/src/modules/administration/index.js';
import { addDays, addYears, today } from '../../server/src/shared/dates.js';
import { prisma } from '../../server/src/shared/db.js';
import { MEMBERS, STAFF } from './data.js';

const PASSWORD = process.env.SEED_PASSWORD || '';

async function main() {
  if (!/\/mlaz_e2e(\?|$)/.test(process.env.DATABASE_URL || '')) throw new Error('seed: DATABASE_URL must be mlaz_e2e');
  if (!PASSWORD) throw new Error('seed: SEED_PASSWORD is not set');

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS e2e_mail (id serial PRIMARY KEY, "to" text NOT NULL, subject text NOT NULL, body text NOT NULL, channel text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION e2e_capture_mail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO e2e_mail ("to", subject, body, channel) VALUES (NEW."to", NEW.subject, NEW.body, NEW.channel::text); RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_capture_mail ON "Notification"');
  await prisma.$executeRawUnsafe('CREATE TRIGGER e2e_capture_mail AFTER INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION e2e_capture_mail()');

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  await prisma.tier.createMany({ data: [
    { name: 'Gold', annualDues: 4500, sortOrder: 1, description: 'Large lenders.' },
    { name: 'Silver', annualDues: 3000, sortOrder: 2, description: 'Established lenders.' },
    { name: 'Bronze', annualDues: 1800, sortOrder: 3, description: 'Small and new lenders.' },
  ] });
  for (const [k, v] of Object.entries(SETTING_DEFAULTS)) await setSetting(prisma, k as keyof typeof SETTING_DEFAULTS, v as never);
  // Fixture members use MLA-9xxx and PAY-96xx; numbers the API hands out start well away from them.
  await prisma.counter.createMany({ data: [{ key: 'member', value: 500 }, { key: 'application', value: 3000 }, { key: 'payment', value: 5000 }, { key: 'expense', value: 0 }] });

  const passwordHash = await hashPassword(PASSWORD);
  for (const s of Object.values(STAFF)) await prisma.user.create({ data: { email: s.email, name: s.name, title: s.name, role: s.role, passwordHash } });

  let i = 0;
  for (const m of Object.values(MEMBERS)) {
    i++;
    const validUntil = addDays(today(), m.dueInDays);
    const member = await prisma.member.create({
      data: {
        number: m.number, name: m.name, town: 'Lusaka', province: 'Lusaka', tpin: String(3000000000 + i), pacra: String(120260090000 + i), tierName: 'Silver',
        status: 'ACTIVE', accreditation: 'ISSUED', mofStatus: 'VALID', mofRef: `MoF/ML/2026/9${String(i).padStart(3, '0')}`, mofExpiry: addYears(today(), 1),
        validUntil, contactName: `Contact ${m.key}`, contactPhone: `097${String(1000000 + i)}`, contactEmail: m.email, joinedAt: addYears(today(), -1),
      },
    });
    await prisma.user.create({ data: { email: m.email, name: `Contact ${m.key}`, role: 'MEMBER', memberId: member.id, passwordHash } });
    if ('certificate' in m) await prisma.certificate.create({ data: { serial: m.certificate, memberId: member.id, issuedAt: addYears(validUntil, -1), validUntil, status: 'VALID' } });
    if ('payment' in m) {
      await prisma.payment.create({
        data: {
          ref: m.payment, purpose: 'DUES', memberId: member.id, payerName: m.name, amount: 3000, method: 'MTN_MOMO', status: 'SUCCESS', provider: 'sandbox', paidAt: new Date(),
          lines: { create: [{ type: 'DUES', description: 'Annual dues (Silver)', unitAmount: 3000, amount: 3000 }] },
        },
      });
    }
  }
  console.log('seed: mlaz_e2e reset with fixture accounts');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

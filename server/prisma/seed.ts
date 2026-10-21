// Demo data, ported from the prototype's src/store.js so the UI shows the same members and applications.
// Run on an empty database: npm run db:reset (drops everything, migrates, then seeds).
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import type { DocumentKind, Role } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/lib/auth.js';
import { addDays, addYears, dateOnly, today } from '../src/lib/dates.js';
import { prisma } from '../src/lib/db.js';
import { storage } from '../src/lib/storage.js';
import { sha256 } from '../src/lib/tokens.js';
import { bureau } from '../src/providers/bureau.js';
import { setSetting, SETTING_DEFAULTS } from '../src/services/settings.js';

const PASSWORD = process.env.SEED_PASSWORD || 'Mlaz@2026demo';
const ago = (hours: number) => new Date(Date.now() - hours * 3600e3);

function placeholderPdf(title: string): Promise<Buffer> {
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: 'A4', margin: 72 });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(20).text(title).moveDown().fontSize(11).fillColor('#666').text('Sample document created by the MLAZ demo seed. Not a real record.');
    doc.end();
  });
}

async function storeDoc(kind: DocumentKind, filename: string, title: string) {
  const buf = await placeholderPdf(title);
  const storageKey = `${kind.toLowerCase()}/seed/${randomUUID()}.pdf`;
  await storage.put(storageKey, buf, 'application/pdf');
  return { kind, storageKey, filename, mimeType: 'application/pdf', size: buf.length, sha256: sha256(buf) };
}

async function main() {
  // Demo accounts share one known password; they must never exist on a live system.
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data in production. Create the first admin with a real invite instead.');
    process.exitCode = 1;
    return;
  }
  if (await prisma.user.count()) {
    console.log('Database already has data; skipping seed. Use `npm run db:reset` to start over.');
    return;
  }
  const passwordHash = await hashPassword(PASSWORD);
  const t = today();

  /* ---------- configuration ---------- */
  await prisma.tier.createMany({
    data: [
      { name: 'Gold', annualDues: 4500, sortOrder: 1, description: 'Large lenders. Priority listing, AGM voting, all trainings included.' },
      { name: 'Silver', annualDues: 3000, sortOrder: 2, description: 'Established lenders. Directory listing, AGM voting, discounted trainings.' },
      { name: 'Bronze', annualDues: 1800, sortOrder: 3, description: 'Small and new lenders. Directory listing and member resources.' },
    ],
  });
  for (const [k, v] of Object.entries(SETTING_DEFAULTS)) await setSetting(prisma, k as keyof typeof SETTING_DEFAULTS, v as never);
  await prisma.counter.createMany({ data: [{ key: 'member', value: 427 }, { key: 'application', value: 2044 }, { key: 'payment', value: 7785 }, { key: 'expense', value: 6 }] });

  /* ---------- staff ---------- */
  const staff: [string, string, string, Role][] = [
    ['secretariat@mlaz.org.zm', 'Grace Mwansa', 'Secretariat Admin', 'ADMIN'],
    ['officer@mlaz.org.zm', 'John Phiri', 'Membership Officer', 'MEMBERSHIP_OFFICER'],
    ['finance@mlaz.org.zm', 'Ruth Banda', 'Finance Officer', 'FINANCE_OFFICER'],
    ['comms@mlaz.org.zm', 'Kelvin Mulenga', 'Communications Officer', 'COMMS_OFFICER'],
  ];
  const users: Record<string, string> = {};
  for (const [email, name, title, role] of staff) users[email] = (await prisma.user.create({ data: { email, name, title, role, passwordHash } })).id;

  /* ---------- members ---------- */
  const M = [
    { number: 'MLA-0421', name: 'QuickLend Microfinance', town: 'Lusaka', province: 'Lusaka', tpin: '1001845523', tier: 'Gold', status: 'ACTIVE', mof: 'VALID', mofRef: 'MoF/ML/2024/1180', validUntil: '2027-03-31', contact: 'Agnes Chisha', phone: '097 5xx 412', email: 'info@quicklend.zm', joined: '2024-02-10' },
    { number: 'MLA-0422', name: 'Kwacha Credit Solutions', town: 'Kitwe', province: 'Copperbelt', tpin: '1002217840', tier: 'Gold', status: 'ACTIVE', mof: 'VALID', mofRef: 'MoF/ML/2023/0874', validUntil: '2027-06-30', contact: 'Peter Sinkamba', phone: '096 7xx 880', email: 'admin@kwachacredit.zm', joined: '2023-11-05' },
    { number: 'MLA-0423', name: 'ZedFunds Money Lenders', town: 'Ndola', province: 'Copperbelt', tpin: '1003391175', tier: 'Silver', status: 'ACTIVE', mof: 'VALID', mofRef: 'MoF/ML/2024/1422', validUntil: '2026-12-31', contact: 'Mary Banda', phone: '095 1xx 027', email: 'hello@zedfunds.zm', joined: '2024-07-22' },
    { number: 'MLA-0424', name: 'Lusaka Cash Advance', town: 'Lusaka', province: 'Lusaka', tpin: '1004518806', tier: 'Silver', status: 'ACTIVE', mof: 'VALID', mofRef: 'MoF/ML/2025/0219', validUntil: '2027-01-15', contact: 'George Sakala', phone: '096 9xx 134', email: 'ops@lusakacash.zm', joined: '2025-01-18' },
    { number: 'MLA-0425', name: 'Copperbelt Credit Ltd', town: 'Kitwe', province: 'Copperbelt', tpin: '1001207731', tier: 'Gold', status: 'ACTIVE', mof: 'VALID', mofRef: 'MoF/ML/2023/0612', validUntil: '2027-04-30', contact: 'Thomas Zulu', phone: '095 3xx 167', email: 'info@cbcredit.zm', joined: '2023-09-11' },
    { number: 'MLA-0426', name: 'Southern Loans', town: 'Livingstone', province: 'Southern', tpin: '1003064412', tier: 'Bronze', status: 'LAPSED', mof: 'VALID', mofRef: 'MoF/ML/2024/1031', validUntil: '2026-05-31', contact: 'Beatrice Zulu', phone: '096 2xx 590', email: 'southern@loans.zm', joined: '2024-03-30' },
    { number: 'MLA-0427', name: 'Chingola Finance', town: 'Chingola', province: 'Copperbelt', tpin: '1004730958', tier: 'Silver', status: 'SUSPENDED', mof: 'EXPIRED', mofRef: 'MoF/ML/2024/1610', validUntil: '2027-02-28', contact: 'Robert Mulenga', phone: '097 2xx 318', email: 'info@chingolafin.zm', joined: '2024-10-02' },
  ] as const;

  const members: Record<string, string> = {};
  for (const m of M) {
    const validUntil = dateOnly(m.validUntil);
    const member = await prisma.member.create({
      data: {
        number: m.number, name: m.name, town: m.town, province: m.province, tpin: m.tpin, tierName: m.tier,
        status: m.status, accreditation: m.status === 'ACTIVE' ? 'ISSUED' : m.status === 'LAPSED' ? 'EXPIRED' : 'REVOKED',
        suspension: m.status === 'SUSPENDED' ? 'MOF_EXPIRED' : null,
        suspensionReason: m.status === 'SUSPENDED' ? `Ministry of Finance authorization ${m.mofRef} expired on 28 Feb 2026` : null,
        mofStatus: m.mof, mofRef: m.mofRef, mofExpiry: m.mof === 'VALID' ? addYears(validUntil, 1) : dateOnly('2026-02-28'),
        validUntil, contactName: m.contact, contactPhone: m.phone, contactEmail: m.email, joinedAt: dateOnly(m.joined),
      },
    });
    members[m.number] = member.id;
    await prisma.user.create({ data: { email: m.email, name: m.contact, role: 'MEMBER', memberId: member.id, passwordHash } });
    await prisma.certificate.create({
      data: {
        serial: `MLAZ/ACC/${m.number.slice(4)}/${String(addYears(validUntil, -1).getUTCFullYear()).slice(2)}`, memberId: member.id,
        issuedAt: addYears(validUntil, -1), validUntil, status: m.status === 'SUSPENDED' ? 'REVOKED' : 'VALID',
      },
    });
    await prisma.memberActivity.create({ data: { memberId: member.id, kind: 'accreditation_issued', title: 'Accreditation issued', detail: 'After MoF verification', at: addYears(validUntil, -1) } });
    const doc = await storeDoc('MOF_AUTHORIZATION', 'MoF authorization.pdf', `MoF authorization ${m.mofRef}`);
    await prisma.document.create({ data: { ...doc, memberId: member.id, uploadedBy: 'Seed data' } });
  }

  /* ---------- payments ---------- */
  const pay = async (ref: string, number: string, description: string, amount: number, method: 'MTN_MOMO' | 'CARD' | 'BANK_TRANSFER', status: 'SUCCESS' | 'FAILED', hoursAgo: number, dues?: { start: string; end: string }) => {
    const m = M.find(x => x.number === number)!;
    const p = await prisma.payment.create({
      data: {
        ref, purpose: 'DUES', memberId: members[number], payerName: m.name, amount, method, status, provider: method === 'BANK_TRANSFER' ? 'bank' : 'sandbox',
        createdAt: ago(hoursAgo), paidAt: status === 'SUCCESS' ? ago(hoursAgo) : null, failureReason: status === 'FAILED' ? 'Declined by the payer' : null,
        lines: { create: [{ type: 'DUES', description, unitAmount: amount, amount }] },
      },
    });
    if (dues) await prisma.duesPayment.create({ data: { memberId: members[number], paymentId: p.id, periodStart: dateOnly(dues.start), periodEnd: dateOnly(dues.end), amount } });
  };
  await pay('PAY-7781', 'MLA-0421', 'Annual dues (Gold)', 4500, 'MTN_MOMO', 'SUCCESS', 2, { start: '2026-04-01', end: '2027-03-31' });
  await pay('PAY-7782', 'MLA-0424', 'Annual dues (Silver)', 3000, 'CARD', 'SUCCESS', 3, { start: '2026-01-16', end: '2027-01-15' });
  await pay('PAY-7784', 'MLA-0425', 'Annual dues (Gold)', 4500, 'BANK_TRANSFER', 'SUCCESS', 26, { start: '2026-05-01', end: '2027-04-30' });
  await pay('PAY-7785', 'MLA-0423', 'Annual dues (Silver)', 3000, 'MTN_MOMO', 'FAILED', 28);
  await prisma.memberActivity.create({ data: { memberId: members['MLA-0421'], kind: 'dues_paid', title: 'Annual dues paid', detail: 'K4,500 · MTN MoMo · PAY-7781', at: ago(2) } });

  /* ---------- applications ---------- */
  const apps = [
    { ref: 'APP-2041', businessName: 'Solwezi Quick Loans', town: 'Solwezi', province: 'North-Western', contactName: 'Joseph Kapenda', position: 'Managing Director', phone: '097 8xx 245', email: 'info@solweziquickloans.zm', pacra: '120260004117', tpin: '1005893312', tierName: 'Silver', stage: 'MOF_REVIEW', mofRef: 'MoF/ML/2026/3312', directorName: 'Joseph Kapenda', directorNrc: '284512/11/1', hoursAgo: 5 },
    { ref: 'APP-2042', businessName: 'Mazabuka Credit Hub', town: 'Mazabuka', province: 'Southern', contactName: 'Lillian Daka', position: 'Director', phone: '095 6xx 702', email: 'hello@mazabukacredit.zm', pacra: '120250019832', tpin: '1005127764', tierName: 'Silver', stage: 'PAYMENT_PENDING', mofRef: 'MoF/ML/2026/3318', directorName: 'Lillian Daka', directorNrc: '199230/71/1', hoursAgo: 48 },
    { ref: 'APP-2043', businessName: 'Kabwe Money Point', town: 'Kabwe', province: 'Central', contactName: 'Esther Banda', position: 'Owner', phone: '096 4xx 991', email: 'kabwemoneypoint@gmail.com', pacra: '120260002270', tpin: '1005340019', tierName: 'Bronze', stage: 'DETAILS', mofRef: null, directorName: 'Esther Banda', directorNrc: '320871/41/1', hoursAgo: 30 },
    { ref: 'APP-2044', businessName: 'Chipata Cash Services', town: 'Chipata', province: 'Eastern', contactName: 'Peter Mumba', position: 'Managing Director', phone: '095 3xx 110', email: 'admin@chipatacash.zm', pacra: '120250021954', tpin: '1004982216', tierName: 'Silver', stage: 'MOF_REVIEW', mofRef: 'MoF/ML/2026/3301', directorName: 'Peter Mumba', directorNrc: '251176/51/1', hoursAgo: 26 },
  ] as const;
  for (const { hoursAgo, ...a } of apps) {
    const recommended = a.ref === 'APP-2044' || a.ref === 'APP-2042';
    const app = await prisma.application.create({
      data: {
        ...a, submittedAt: ago(hoursAgo), mofExpiry: a.mofRef ? addDays(addYears(t, 1), -1) : null,
        ...(recommended && { recommendedById: users['officer@mlaz.org.zm'], recommendedAt: ago(a.ref === 'APP-2044' ? 3 : 22), recommendationNote: 'Authorization confirmed on the MoF register. TPIN active.' }),
        ...(a.ref === 'APP-2042' && { approvedById: users['secretariat@mlaz.org.zm'], approvedAt: ago(20) }),
      },
    });
    const docs = [await storeDoc('PACRA_CERTIFICATE', 'Certificate of incorporation.pdf', `PACRA certificate · ${a.businessName}`), await storeDoc('DIRECTOR_NRC', 'Director NRC.pdf', `Director NRC · ${a.directorName}`)];
    if (a.mofRef) docs.push(await storeDoc('MOF_AUTHORIZATION', 'MoF authorization.pdf', `MoF authorization ${a.mofRef}`));
    await prisma.document.createMany({ data: docs.map(d => ({ ...d, applicationId: app.id, uploadedBy: `${a.contactName} (applicant)`, createdAt: ago(hoursAgo) })) });
  }

  /* ---------- events, announcements, expenses ---------- */
  const events = [
    { name: 'Responsible Lending & BoZ Compliance Workshop', date: '2026-10-28', venue: 'Kitwe', type: 'TRAINING', capacity: 80, price: 0 },
    { name: 'Digital Lending & Credit Scoring Briefing', date: '2026-11-05', venue: 'Online', type: 'WEBINAR', capacity: 500, price: 250 },
    { name: 'MLAZ Annual General Meeting 2026', date: '2026-11-20', venue: 'Lusaka — Mulungushi International Conference Centre', type: 'AGM', capacity: 200, price: 500 },
  ] as const;
  const eventIds: Record<string, string> = {};
  for (const e of events) eventIds[e.name] = (await prisma.event.create({ data: { ...e, date: dateOnly(e.date) } })).id;

  await prisma.announcement.createMany({
    data: [
      { title: '2027 membership renewals now open', tag: 'Renewals', publishedAt: new Date('2026-09-28T08:00:00Z'), createdBy: 'Grace Mwansa (Secretariat Admin)', body: 'Renew before your accreditation expires to keep your listing in the public directory.' },
      { title: 'New: upload your MoF authorization online', tag: 'Platform', publishedAt: new Date('2026-09-20T08:00:00Z'), createdBy: 'Grace Mwansa (Secretariat Admin)', body: 'Members can now upload and renew their Ministry of Finance money-lending authorization directly in the portal.' },
      { title: 'BoZ interest-disclosure guidance circulated', tag: 'Compliance', publishedAt: new Date('2026-09-10T08:00:00Z'), createdBy: 'Kelvin Mulenga (Communications Officer)', body: 'Please review the updated disclosure guidance in the resource library and apply by month-end.' },
    ],
  });

  const expenses = [
    ['EXP-0001', '2026-09-25', 'Printing & materials', 'Certificates, letterheads and workshop handbooks', 'Lusaka Print House', 4200, 'Mobile money', null],
    ['EXP-0002', '2026-10-01', 'Office & admin', 'Secretariat office rent, October', 'Cairo Road Properties Ltd', 14000, 'Bank transfer', null],
    ['EXP-0003', '2026-10-03', 'Software & subscriptions', 'Webinar platform licence, 500 attendees', 'Zoom Video Communications', 1850, 'Card', 'Digital Lending & Credit Scoring Briefing'],
    ['EXP-0004', '2026-10-06', 'Venue booking', 'Main hall deposit (50%)', 'Mulungushi International Conference Centre', 25000, 'Bank transfer', 'MLAZ Annual General Meeting 2026'],
    ['EXP-0005', '2026-10-10', 'Catering', 'Lunch and teas for 80 delegates', 'Copper Kitchen Caterers', 12000, 'Bank transfer', 'Responsible Lending & BoZ Compliance Workshop'],
    ['EXP-0006', '2026-10-12', 'Venue booking', 'Hotel conference room hire, 1 day', 'Edinburgh Hotel, Kitwe', 9500, 'Bank transfer', 'Responsible Lending & BoZ Compliance Workshop'],
  ] as const;
  for (const [ref, date, category, description, payee, amount, method, event] of expenses) {
    await prisma.expense.create({ data: { ref, date: dateOnly(date), category, description, payee, amount, method, eventId: event ? eventIds[event] : null, recordedBy: 'Grace Mwansa (Secretariat Admin)' } });
  }

  /* ---------- a loan book for QuickLend, scored by the (simulated) bureau ---------- */
  const firstNames = ['Mwila', 'Chanda', 'Bwalya', 'Natasha', 'Kondwani', 'Thandiwe', 'Musonda', 'Chileshe', 'Lubinda', 'Mutale', 'Namakau', 'Mapalo'];
  for (let i = 0; i < 12; i++) {
    const nrc = `${String(150000 + i * 13579).slice(0, 6)}/${String(11 + i * 3).padStart(2, '0')}/1`;
    const rec = await bureau.lookup(nrc);
    const amount = 2000 + i * 1500;
    const status = i % 5 === 0 ? 'CLOSED' : rec && rec.score < 600 && i % 2 ? 'ARREARS' : 'CURRENT';
    await prisma.loan.create({
      data: {
        memberId: members['MLA-0421'], borrowerNrc: nrc, borrowerName: rec?.name ?? `${firstNames[i]} Phiri`, borrowerPhone: rec?.phone ?? '',
        amount, balance: status === 'CLOSED' ? 0 : Math.round(amount * 0.6), status, issuedAt: addDays(t, -(30 + i * 25)),
        lastScore: rec?.score ?? null, lastCheckedAt: rec ? new Date() : null,
      },
    });
  }

  /* ---------- audit trail ---------- */
  await prisma.auditLog.createMany({
    data: [
      { at: ago(48), actorType: 'APPLICANT', actorLabel: 'Lillian Daka (applicant)', target: 'APP-2042', action: 'Application submitted', note: 'MoF authorization, PACRA certificate and director NRC uploaded' },
      { at: ago(30), actorType: 'APPLICANT', actorLabel: 'Esther Banda (applicant)', target: 'APP-2043', action: 'Application submitted', note: 'PACRA certificate and director NRC uploaded · MoF authorization to follow' },
      { at: ago(26), actorType: 'APPLICANT', actorLabel: 'Peter Mumba (applicant)', target: 'APP-2044', action: 'Application submitted', note: 'MoF authorization, PACRA certificate and director NRC uploaded' },
      { at: ago(22), actorType: 'STAFF', actorId: users['officer@mlaz.org.zm'], actorLabel: 'John Phiri (Membership Officer)', target: 'APP-2042', action: 'Recommended for approval', note: 'Authorization confirmed on the MoF register. TPIN active.' },
      { at: ago(20), actorType: 'STAFF', actorId: users['secretariat@mlaz.org.zm'], actorLabel: 'Grace Mwansa (Secretariat Admin)', target: 'APP-2042', action: 'Approved (checker)', note: 'Recommended by John Phiri' },
      { at: ago(5), actorType: 'APPLICANT', actorLabel: 'Joseph Kapenda (applicant)', target: 'APP-2041', action: 'Application submitted', note: 'MoF authorization, PACRA certificate and director NRC uploaded' },
      { at: ago(3), actorType: 'STAFF', actorId: users['officer@mlaz.org.zm'], actorLabel: 'John Phiri (Membership Officer)', target: 'APP-2044', action: 'Recommended for approval', note: 'Authorization confirmed on the MoF register. TPIN active.' },
    ],
  });

  console.log(`Seeded. Every demo account uses the password: ${PASSWORD}`);
  console.log('Staff: secretariat@ (Admin), officer@ (Membership), finance@ (Finance), comms@ (Comms) @mlaz.org.zm · Member: info@quicklend.zm');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

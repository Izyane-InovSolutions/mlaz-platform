import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { addYears, isoDate, today } from '../src/lib/dates.js';
import { reconcilePending } from '../src/services/payments.js';
import { PASSWORD, PDF, STAFF, as, form, getApp, resetDb, tokenFromEmail } from './helpers.js';

const applicant = {
  name: 'Mongu Microloans Ltd', pacra: '120260009999', tpin: '1009876543', town: 'Mongu', province: 'Western', address: 'Plot 12, Mongu',
  tier: 'Bronze', contact: 'Inonge Mubita', position: 'Director', phone: '0977000111', email: 'inonge@mongumicro.zm',
  director: 'Inonge Mubita', directorNrc: '123456/78/1', declare: 'true',
};
const expiry = isoDate(addYears(today(), 1));

async function submit(fields: Record<string, string> = applicant, files: Record<string, Buffer> = { pacraFile: PDF, nrcFile: PDF }) {
  const app = await getApp();
  return app.inject({ method: 'POST', url: '/api/public/applications', payload: form(fields, files) });
}

describe('membership application lifecycle', () => {
  beforeAll(resetDb);

  let ref = '', token = '';
  const track = (path = '', method: 'GET' | 'POST' = 'GET', payload?: unknown) =>
    getApp().then(a => a.inject({ method, url: `/api/public/applications/${ref}${path}`, headers: { 'x-tracking-token': token }, ...(payload !== undefined && { payload: payload as object }) }));

  it('rejects an application without the required documents', async () => {
    const res = await submit(applicant, { pacraFile: PDF });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/NRC/);
  });

  it('rejects files that are not PDF or images, whatever their name', async () => {
    const res = await submit(applicant, { pacraFile: Buffer.from('MZ fake executable'), nrcFile: PDF });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/only PDF, JPG or PNG/);
  });

  it('accepts an application and returns a tracking token', async () => {
    const res = await submit();
    expect(res.statusCode, res.body).toBe(201);
    ({ ref, trackingToken: token } = res.json());
    expect(ref).toBe('APP-0501');
    expect(res.json().stage).toBe('DETAILS');
    expect(await prisma.notification.count({ where: { to: applicant.email } })).toBe(1);
  });

  it('hides the application from anyone without the token', async () => {
    const app = await getApp();
    expect((await app.inject({ url: `/api/public/applications/${ref}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/public/applications/${ref}?t=wrong-token-value-1234567890` })).statusCode).toBe(404);
    const ok = await track();
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ stage: 'DETAILS', fees: { joiningFee: 2000, annualDues: 1800, total: 3800 } });
  });

  it('moves to MoF review when the applicant uploads the authorization', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: `/api/public/applications/${ref}/mof`, headers: { 'x-tracking-token': token }, payload: form({ mofRef: 'MoF/ML/2026/9001' }, { mofFile: PDF }) });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().stage).toBe('MOF_REVIEW');
  });

  it('flags a possible duplicate when another application shares the TPIN', async () => {
    const dup = await submit({ ...applicant, name: 'Another Name Ltd', email: 'other@example.zm', phone: '0961112222' });
    expect(dup.statusCode).toBe(201);
    const officer = await as(STAFF.officer);
    const detail = (await officer.get(`/admin/applications/${ref}`)).json();
    expect(detail.checks.duplicates.map((d: { ref: string }) => d.ref)).toContain(dup.json().ref);
    expect(detail.checks.flags).toContain('possible duplicate');
  });

  it('requires an explanation when checks are flagged', async () => {
    const officer = await as(STAFF.officer);
    const res = await officer.post(`/admin/applications/${ref}/recommend`, { mofExpiry: expiry, note: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/possible duplicate/);
  });

  it('enforces maker-checker: the recommending officer cannot approve', async () => {
    const officer = await as(STAFF.officer);
    const rec = await officer.post(`/admin/applications/${ref}/recommend`, { mofExpiry: expiry, note: 'Duplicate TPIN is a typo by the other applicant; confirmed by phone.' });
    expect(rec.statusCode, rec.body).toBe(200);
    expect(rec.json().displayStage).toBe('AWAITING_APPROVAL');
    // The officer role has no approve permission at all...
    expect((await officer.post(`/admin/applications/${ref}/approve`)).statusCode).toBe(403);
  });

  it('enforces maker-checker even for an admin who recommended', async () => {
    const other = (await submit({ ...applicant, name: 'Third Lender', tpin: '1000000003', pacra: '120260000003', email: 'third@example.zm', phone: '0950000003' }, { pacraFile: PDF, nrcFile: PDF, mofFile: PDF })).json();
    // (no mofRef given with the file → rejected; give it properly)
    expect(other.error?.message ?? '').toMatch(/authorization reference/);
    const ok = (await submit({ ...applicant, name: 'Third Lender', tpin: '1000000003', pacra: '120260000003', email: 'third@example.zm', phone: '0950000003', mofRef: 'MoF/ML/2026/3' }, { pacraFile: PDF, nrcFile: PDF, mofFile: PDF })).json();
    const admin = await as(STAFF.admin);
    expect((await admin.post(`/admin/applications/${ok.ref}/recommend`, { mofExpiry: expiry, note: 'Checked against the register, all fine.' })).statusCode).toBe(200);
    const res = await admin.post(`/admin/applications/${ok.ref}/approve`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('MAKER_CHECKER');
  });

  it('lets a different officer approve, which sends the payment link', async () => {
    const admin = await as(STAFF.admin);
    const res = await admin.post(`/admin/applications/${ref}/approve`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().stage).toBe('PAYMENT_PENDING');
    const email = await prisma.notification.findFirst({ where: { to: applicant.email, subject: { contains: 'approved' } } });
    expect(email?.body).toContain(`t=${token}`);
  });

  it('takes payment by mobile money and refuses a second attempt while it is in flight', async () => {
    const first = await track('/payments', 'POST', { method: 'MTN_MOMO', msisdn: '0977 123 456' });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ status: 'PENDING', amount: 3800, methodLabel: 'MTN MoMo' });
    const second = await track('/payments', 'POST', { method: 'AIRTEL_MONEY', msisdn: '0961234567' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('PAYMENT_IN_PROGRESS');
  });

  it('accredits automatically when the payment settles, exactly once', async () => {
    const r1 = await reconcilePending();
    expect(r1.settled).toBe(1);
    await reconcilePending(); // nothing left to settle; must not create a second member
    const view = (await track()).json();
    expect(view.stage).toBe('ACCREDITED');
    expect(view.member.number).toBe('MLA-0101');
    expect(view.member.certificateSerial).toMatch(/^MLAZ\/ACC\/0101\/\d\d$/);
    expect(await prisma.member.count({ where: { tpin: applicant.tpin } })).toBe(1);

    const verify = (await (await getApp()).inject({ url: '/api/public/verify?q=MLA-0101' })).json();
    expect(verify.results[0]).toMatchObject({ name: applicant.name, goodStanding: true });
  });

  it('lets the new member activate the portal from the welcome email', async () => {
    const app = await getApp();
    const token = await tokenFromEmail(applicant.email);
    const set = await app.inject({ method: 'POST', url: '/api/auth/password/set', payload: { token, password: PASSWORD } });
    expect(set.statusCode, set.body).toBe(200);
    // The link is single-use.
    expect((await app.inject({ method: 'POST', url: '/api/auth/password/set', payload: { token, password: PASSWORD } })).statusCode).toBe(400);

    const member = await as(applicant.email);
    const overview = await member.get('/portal/overview');
    expect(overview.statusCode).toBe(200);
    expect(overview.json().member).toMatchObject({ number: 'MLA-0101', goodStanding: true, status: 'ACTIVE' });
    const pdf = await member.get('/portal/certificate.pdf');
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('records the whole journey in the audit trail', async () => {
    const actions = (await prisma.auditLog.findMany({ where: { target: ref }, orderBy: { at: 'asc' } })).map(a => a.action);
    expect(actions).toEqual(expect.arrayContaining(['Application submitted', 'MoF authorization uploaded', 'Recommended for approval', 'Approved (checker)', 'Payment link sent', 'Payment received', 'Accreditation issued']));
  });

  it('returns an application to the applicant with a reason', async () => {
    const res = await submit({ ...applicant, name: 'Returned Lender', tpin: '1000000004', pacra: '120260000004', email: 'ret@example.zm', phone: '0950000004', mofRef: 'MoF/ML/2026/4' }, { pacraFile: PDF, nrcFile: PDF, mofFile: PDF });
    const r = res.json().ref;
    const officer = await as(STAFF.officer);
    const ret = await officer.post(`/admin/applications/${r}/return`, { reason: 'Authorization not found on the MoF register.' });
    expect(ret.statusCode).toBe(200);
    expect(ret.json()).toMatchObject({ stage: 'DETAILS', returnNote: 'Authorization not found on the MoF register.', mofRef: null });
    expect(ret.json().documents.find((d: { kind: string }) => d.kind === 'MOF_AUTHORIZATION').superseded).toBe(true);
  });
});

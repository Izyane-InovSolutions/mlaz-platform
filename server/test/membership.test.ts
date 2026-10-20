import { beforeAll, describe, expect, it } from 'vitest';
import { runNightly } from '../src/jobs/runner.js';
import { addDays, addYears, isoDate, today } from '../src/lib/dates.js';
import { prisma } from '../src/lib/db.js';
import { PDF, STAFF, as, form, getApp, makeMember, resetDb } from './helpers.js';

describe('nightly membership rules and MoF renewals', () => {
  beforeAll(resetDb);

  it('lapses a member whose paid period has ended', async () => {
    const m = await makeMember({ validUntil: addDays(today(), -1) });
    await runNightly();
    expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'LAPSED', accreditation: 'EXPIRED' });
    const v = (await (await getApp()).inject({ url: `/api/public/verify?q=${m.number}` })).json();
    expect(v.results[0].goodStanding).toBe(false);
  });

  it('suspends on MoF expiry, then restores the member when a renewal is verified', async () => {
    const m = await makeMember({ mofExpiry: addDays(today(), -1) });
    await runNightly();
    expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'SUSPENDED', suspension: 'MOF_EXPIRED', mofStatus: 'EXPIRED', accreditation: 'REVOKED' });

    const member = await as(m.email);
    expect((await member.get('/portal/certificate.pdf')).statusCode).toBe(409);
    const up = await member.multipart('/portal/mof-renewals', form({ mofRef: 'MoF/ML/2027/0001' }, { file: PDF }));
    expect(up.statusCode, up.body).toBe(201);
    expect((await member.multipart('/portal/mof-renewals', form({ mofRef: 'X' }, { file: PDF }))).json().error.code).toBe('RENEWAL_PENDING');

    const officer = await as(STAFF.officer);
    const pending = (await officer.get('/admin/renewals')).json();
    const r = pending.find((x: { member: { number: string } }) => x.member.number === m.number);
    const res = await officer.post(`/admin/renewals/${r.id}/verify`, { mofExpiry: isoDate(addYears(today(), 1)) });
    expect(res.statusCode, res.body).toBe(200);
    expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'ACTIVE', accreditation: 'ISSUED', mofStatus: 'VALID', suspension: null, mofRef: 'MoF/ML/2027/0001' });
    expect((await member.get('/portal/certificate.pdf')).statusCode).toBe(200);
  });

  it('keeps a staff suspension in place when a renewal is verified', async () => {
    const m = await makeMember();
    const officer = await as(STAFF.officer);
    expect((await officer.post(`/admin/members/${m.number}/suspend`, { reason: 'Breach of the code of conduct' })).statusCode).toBe(204);
    await (await as(m.email)).multipart('/portal/mof-renewals', form({ mofRef: 'MoF/ML/2027/0002' }, { file: PDF }));
    const r = await prisma.mofRenewal.findFirstOrThrow({ where: { memberId: m.id } });
    await officer.post(`/admin/renewals/${r.id}/verify`, { mofExpiry: isoDate(addYears(today(), 2)) });
    expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'SUSPENDED', suspension: 'STAFF' });

    expect((await officer.post(`/admin/members/${m.number}/reinstate`)).statusCode).toBe(204);
    expect(await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'ACTIVE', accreditation: 'ISSUED' });
  });

  it('will not reinstate a member whose MoF authorization has expired', async () => {
    const m = await makeMember({ mofExpiry: addDays(today(), -3) });
    await runNightly();
    const res = await (await as(STAFF.officer)).post(`/admin/members/${m.number}/reinstate`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MOF_INVALID');
  });

  it('sends each expiry reminder once', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 30) });
    await runNightly();
    await runNightly();
    expect(await prisma.notification.count({ where: { to: m.email, subject: { contains: 'expires in 30 days' } } })).toBe(1);
  });
});

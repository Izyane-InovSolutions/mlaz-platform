import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { addDays, addYears, isoDate, today } from '../src/lib/dates.js';
import { prisma } from '../src/lib/db.js';
import { hmac } from '../src/lib/tokens.js';
import { reconcilePending, settle } from '../src/services/payments.js';
import { SYSTEM } from '../src/lib/audit.js';
import { PDF, STAFF, as, form, getApp, makeMember, resetDb } from './helpers.js';

describe('dues payments', () => {
  beforeAll(resetDb);

  it('refuses dues that are not payable yet', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 200) });
    const res = await (await as(m.email)).post('/portal/dues/payments', { method: 'MTN_MOMO', msisdn: '0977123456' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DUES_NOT_PAYABLE');
  });

  it('takes a bank transfer with proof, confirmed by Finance, and extends the membership a year', async () => {
    const validUntil = addDays(today(), 20);
    const m = await makeMember({ validUntil });
    const member = await as(m.email);

    const start = await member.post('/portal/dues/payments', { method: 'BANK_TRANSFER' });
    expect(start.statusCode, start.body).toBe(201);
    const p = start.json();
    expect(p).toMatchObject({ status: 'PENDING', awaitingProof: true, amount: 3000 });
    expect(p.bankAccount.number).toBeTruthy();

    const proof = await member.multipart(`/portal/payments/${p.ref}/proof`, form({ bankRef: 'FT26293XYZ' }, { proof: PDF }));
    expect(proof.statusCode, proof.body).toBe(200);
    expect(proof.json()).toMatchObject({ hasProof: true, awaitingProof: false, bankRef: 'FT26293XYZ' });

    // A second payment cannot be started while Finance is checking this one.
    const again = await member.post('/portal/dues/payments', { method: 'MTN_MOMO', msisdn: '0977123456' });
    expect(again.json().error.code).toBe('PAYMENT_AWAITING_CONFIRMATION');

    // Only Finance (or the admin) can confirm.
    expect((await (await as(STAFF.officer)).post(`/admin/payments/${p.ref}/confirm`)).statusCode).toBe(403);
    const finance = await as(STAFF.finance);
    const queue = (await finance.get('/admin/payments?awaitingReview=true')).json();
    expect(queue.items.map((x: { ref: string }) => x.ref)).toContain(p.ref);
    const ok = await finance.post(`/admin/payments/${p.ref}/confirm`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'SUCCESS', reviewedBy: 'Test finance (Finance Officer)' });

    const after = await prisma.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(isoDate(after.validUntil)).toBe(isoDate(addDays(addYears(addDays(validUntil, 1), 1), -1)));
    expect(await prisma.certificate.count({ where: { memberId: m.id, status: 'VALID' } })).toBe(1);

    const receipt = await member.get(`/portal/payments/${p.ref}/receipt.pdf`);
    expect(receipt.headers['content-type']).toBe('application/pdf');
  });

  it('restores a lapsed member when dues are paid', async () => {
    const m = await makeMember({ validUntil: addDays(today(), -10), status: 'LAPSED' });
    const p = (await (await as(m.email)).post('/portal/dues/payments', { method: 'AIRTEL_MONEY', msisdn: '0961234567' })).json();
    await reconcilePending();
    const after = await prisma.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ status: 'ACTIVE', accreditation: 'ISSUED' });
    expect(isoDate(after.validUntil)).toBe(isoDate(addDays(addYears(today(), 1), -1)));
    expect((await prisma.payment.findUniqueOrThrow({ where: { ref: p.ref } })).status).toBe('SUCCESS');
  });

  it('marks a declined mobile money payment as failed and changes nothing else', async () => {
    const validUntil = addDays(today(), 5);
    const m = await makeMember({ validUntil });
    const p = (await (await as(m.email)).post('/portal/dues/payments', { method: 'MTN_MOMO', msisdn: '0977000000' })).json();
    await reconcilePending();
    const after = await prisma.payment.findUniqueOrThrow({ where: { ref: p.ref } });
    expect(after).toMatchObject({ status: 'FAILED', failureReason: 'Declined by the payer' });
    expect(isoDate((await prisma.member.findUniqueOrThrow({ where: { id: m.id } })).validUntil)).toBe(isoDate(validUntil));
  });

  it('rejects a proof of payment with a reason the payer is told', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 10) });
    const member = await as(m.email);
    const p = (await member.post('/portal/dues/payments', { method: 'BANK_TRANSFER' })).json();
    await member.multipart(`/portal/payments/${p.ref}/proof`, form({ bankRef: 'FT1' }, { proof: PDF }));
    const res = await (await as(STAFF.finance)).post(`/admin/payments/${p.ref}/reject`, { reason: 'Not on the bank statement.' });
    expect(res.json()).toMatchObject({ status: 'FAILED', failureReason: 'Not on the bank statement.' });
    expect(await prisma.notification.count({ where: { to: m.email, subject: { contains: 'could not be confirmed' } } })).toBe(1);
  });

  it('records offline dues from the console', async () => {
    const m = await makeMember({ validUntil: addDays(today(), 3) });
    const res = await (await as(STAFF.finance)).post(`/admin/members/${m.number}/offline-dues`, { method: 'CASH', reference: 'RCPT-77' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: 'SUCCESS', methodLabel: 'Cash', recordedBy: 'Test finance (Finance Officer)' });
  });
});

describe('payment webhooks and settlement', () => {
  beforeAll(resetDb);

  async function pendingPayment() {
    const m = await makeMember({ validUntil: addDays(today(), 5) });
    const p = (await (await as(m.email)).post('/portal/dues/payments', { method: 'MTN_MOMO', msisdn: '0977123456' })).json();
    return prisma.payment.findUniqueOrThrow({ where: { ref: p.ref } });
  }

  it('rejects a webhook with a bad signature', async () => {
    const p = await pendingPayment();
    const body = JSON.stringify({ providerRef: p.providerRef, status: 'SUCCESS' });
    const res = await (await getApp()).inject({ method: 'POST', url: '/api/webhooks/payments/sandbox', headers: { 'content-type': 'application/json', 'x-sandbox-signature': 'bad' }, payload: body });
    expect(res.statusCode).toBe(400);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PENDING');
  });

  it('settles a payment from a correctly signed webhook, and ignores a replay', async () => {
    const p = await pendingPayment();
    const body = JSON.stringify({ providerRef: p.providerRef, status: 'SUCCESS' });
    const send = async () => (await getApp()).inject({ method: 'POST', url: '/api/webhooks/payments/sandbox', headers: { 'content-type': 'application/json', 'x-sandbox-signature': hmac(config.WEBHOOK_SECRET, body) }, payload: body });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect(await prisma.duesPayment.count({ where: { paymentId: p.id } })).toBe(1);
  });

  it('honours a success that arrives after the payment timed out', async () => {
    const p = await pendingPayment();
    await settle(p.id, { status: 'FAILED', failureReason: 'No confirmation from the payment provider (timed out)' }, SYSTEM);
    await settle(p.id, { status: 'SUCCESS' }, SYSTEM);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('SUCCESS');
    expect(await prisma.duesPayment.count({ where: { paymentId: p.id } })).toBe(1);
  });

  it('does not flip a genuinely declined payment to success', async () => {
    const p = await pendingPayment();
    await settle(p.id, { status: 'FAILED', failureReason: 'Declined by the payer' }, SYSTEM);
    await settle(p.id, { status: 'SUCCESS' }, SYSTEM);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('FAILED');
  });
});

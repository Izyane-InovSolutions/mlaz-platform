import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { Certificate, Member } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { fmtDate, fmtDateTime } from '../lib/dates.js';
import { K } from '../lib/money.js';
import { inGoodStanding } from './membership.js';
import type { paymentView } from './payments.js';

const BRAND = '#0b5e3b', DARK = '#0b2e59', MUTED = '#5f6b7a';

function render(opts: PDFKit.PDFDocumentOptions, draw: (doc: PDFKit.PDFDocument) => Promise<void> | void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...opts, info: { Producer: 'MLAZ platform', ...opts.info } });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve(draw(doc)).then(() => doc.end(), reject);
  });
}

export const verifyUrl = (number: string) => `${config.PUBLIC_APP_URL}/#/verify/${number}`;

/** The accreditation certificate, with a QR code linking to the public verification page. */
export function certificatePdf(m: Member, cert: Certificate) {
  return render({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `MLAZ accreditation ${cert.serial}` } }, async doc => {
    const W = doc.page.width, H = doc.page.height;
    doc.rect(20, 20, W - 40, H - 40).lineWidth(3).stroke(BRAND);
    doc.rect(30, 30, W - 60, H - 60).lineWidth(0.75).stroke(BRAND);

    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(13).text('MONEY LENDERS ASSOCIATION OF ZAMBIA', 0, 70, { align: 'center', characterSpacing: 2 });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(34).text('Certificate of Accreditation', 0, 100, { align: 'center' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(13).text('This is to certify that', 0, 165, { align: 'center' });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(28).text(m.name, 60, 192, { align: 'center', width: W - 120 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(13).text(
      `of ${m.town}, ${m.province} Province, holding Ministry of Finance money-lending authorization ${m.mofRef}, is an accredited ${m.tierName} member of the Money Lenders Association of Zambia and has undertaken to abide by its constitution and code of conduct.`,
      110, 245, { align: 'center', width: W - 220, lineGap: 4 },
    );

    const row = (label: string, value: string, x: number) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, x, 345, { width: 170, align: 'center' });
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(13).text(value, x, 360, { width: 170, align: 'center' });
    };
    row('Member number', m.number, 95);
    row('Certificate no.', cert.serial, 265);
    row('Issued', fmtDate(cert.issuedAt), 435);
    row('Valid until', fmtDate(cert.validUntil), 605);

    const valid = cert.status === 'VALID' && inGoodStanding(m);
    if (!valid) {
      doc.save().rotate(-20, { origin: [W / 2, H / 2] }).fillColor('#c0392b').opacity(0.18).font('Helvetica-Bold').fontSize(90)
        .text(cert.status === 'REVOKED' || m.accreditation === 'REVOKED' ? 'REVOKED' : 'NOT VALID', 0, H / 2 - 50, { align: 'center' }).restore();
    }

    const qr = await QRCode.toBuffer(verifyUrl(m.number), { margin: 1, width: 300, color: { dark: DARK } });
    doc.image(qr, W - 165, H - 175, { width: 105 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Scan to verify', W - 165, H - 66, { width: 105, align: 'center' });

    doc.moveTo(95, H - 110).lineTo(285, H - 110).lineWidth(0.75).stroke(MUTED);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Executive Secretary, MLAZ', 95, H - 102, { width: 190, align: 'center' });
    doc.fontSize(8).text(`Verify at ${verifyUrl(m.number)}`, 95, H - 70, { width: 400 });
  });
}

type PaymentView = Awaited<ReturnType<typeof paymentView>>;

export function receiptPdf(p: PaymentView) {
  return render({ size: 'A4', margin: 56, info: { Title: `MLAZ receipt ${p.ref}` } }, doc => {
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(10).text('MONEY LENDERS ASSOCIATION OF ZAMBIA', { characterSpacing: 1.5 });
    doc.moveDown(0.3).fillColor(DARK).fontSize(22).text('Official receipt');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(`Receipt no. ${p.ref}`, 56, 56, { align: 'right' });
    doc.moveDown(3);

    const field = (label: string, value: string) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(value).moveDown(0.6);
    };
    doc.y = 140;
    field('Received from', p.payerName + (p.memberNumber ? ` (${p.memberNumber})` : p.applicationRef ? ` (application ${p.applicationRef})` : ''));
    field('Date', fmtDateTime(p.paidAt ?? p.createdAt));
    field('Payment method', `${p.methodLabel}${p.bankRef ? ` · ref ${p.bankRef}` : ''}${p.msisdn ? ` · ${p.msisdn}` : ''}`);
    field('Status', p.status === 'SUCCESS' ? 'Paid' : p.status);

    doc.moveDown(0.5);
    const top = doc.y, right = doc.page.width - 56;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text('DESCRIPTION', 56, top).text('AMOUNT', 56, top, { width: right - 56, align: 'right' });
    doc.moveTo(56, top + 14).lineTo(right, top + 14).lineWidth(0.5).stroke(MUTED);
    let y = top + 22;
    for (const l of p.lines) {
      doc.fillColor(DARK).font('Helvetica').fontSize(11).text(l.quantity > 1 ? `${l.description} (${l.quantity} × ${K(l.unitAmount)})` : l.description, 56, y, { width: 360 });
      doc.text(K(l.amount), 56, y, { width: right - 56, align: 'right' });
      y += 22;
    }
    doc.moveTo(56, y).lineTo(right, y).lineWidth(0.5).stroke(MUTED);
    doc.font('Helvetica-Bold').text('Total paid', 56, y + 8).text(K(p.amount), 56, y + 8, { width: right - 56, align: 'right' });

    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(
      'This is a computer-generated receipt and does not require a signature.',
      56, y + 60, { width: right - 56 },
    );
  });
}

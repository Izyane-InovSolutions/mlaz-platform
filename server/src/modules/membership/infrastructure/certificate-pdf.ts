import QRCode from 'qrcode';
import type { Certificate, Member } from '../../../generated/prisma/client.js';
import { config } from '../../../config.js';
import { fmtDate } from '../../../shared/dates.js';
import { PDF_COLOURS, renderPdf } from '../../../shared/pdf.js';
import { inGoodStanding } from '../domain/standing.js';

const { BRAND, DARK, MUTED } = PDF_COLOURS;

export const verifyUrl = (number: string) => `${config.PUBLIC_APP_URL}/#/verify/${number}`;

/** The accreditation certificate, with a QR code linking to the public verification page. */
export function certificatePdf(m: Member, cert: Certificate) {
  return renderPdf({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `MLAZ accreditation ${cert.serial}` } }, async doc => {
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

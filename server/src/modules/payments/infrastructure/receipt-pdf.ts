import { fmtDateTime } from '../../../shared/dates.js';
import { K } from '../../../shared/money.js';
import { PDF_COLOURS, renderPdf } from '../../../shared/pdf.js';
import type { PaymentView } from '../application/queries.js';

const { BRAND, DARK, MUTED } = PDF_COLOURS;

export function receiptPdf(p: PaymentView) {
  return renderPdf({ size: 'A4', margin: 56, info: { Title: `MLAZ receipt ${p.ref}` } }, doc => {
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

// Upload fixtures, built in memory at test time (nothing binary-looking is committed). Each is a file payload that
// page.setInputFiles() and the API request's multipart option both accept.

/** A small, valid one-page PDF (correct xref offsets), so any PDF reader opens it. */
function onePagePdf(title: string) {
  const text = `BT /F1 18 Tf 72 760 Td (${title}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n\r\n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const FILES = {
  /** A valid PDF document. */
  pdf: { name: 'authorization.pdf', mimeType: 'application/pdf', buffer: onePagePdf('MLAZ e2e fixture: sample authorization') },
  /** Plain text: not a PDF, JPG or PNG. */
  text: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Meeting notes. Plain text, not a PDF, JPG or PNG.\n') },
  /** Plain text with a .pdf name and type: the API detects the type from the bytes, not the name. */
  fakePdf: { name: 'renamed-text.pdf', mimeType: 'application/pdf', buffer: Buffer.from('This is plain text saved with a .pdf name.\n') },
};

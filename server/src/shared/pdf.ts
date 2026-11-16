import PDFDocument from 'pdfkit';

// Shared PDF plumbing for the documents modules render (certificates, receipts).

export const PDF_COLOURS = { BRAND: '#0b5e3b', DARK: '#0b2e59', MUTED: '#5f6b7a' } as const;

export function renderPdf(opts: PDFKit.PDFDocumentOptions, draw: (doc: PDFKit.PDFDocument) => Promise<void> | void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...opts, info: { Producer: 'MLAZ platform', ...opts.info } });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve(draw(doc)).then(() => doc.end(), reject);
  });
}

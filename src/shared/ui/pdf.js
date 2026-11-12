import { icon } from './components.js';
import { esc } from './format.js';

/* ================= PDF VIEWER ================= */
// Draws a PDF in the page, one canvas per page, so it can be read without the browser's own PDF viewer (some browsers,
// settings and phones download PDFs instead of showing them). PDF.js is loaded only when the first PDF is shown. It runs
// on this thread, because the CSP allows no workers (worker-src 'none'), and without WebAssembly (no 'wasm-unsafe-eval').
let lib;
function pdfjs() {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs')]).then(([pdf, worker]) => {
    globalThis.pdfjsWorker = worker; // with this set, PDF.js runs its worker code here and never starts a Worker
    return pdf;
  }, e => { lib = undefined; throw e; }); // a failed chunk load (e.g. offline) is retried next time
  return lib;
}

const MAX_SCALE = 2;

/**
 * Renders `blob` (a PDF) into `box`, page by page. Returns a function that stops rendering and frees the document; call
 * it when the box goes away. If the PDF cannot be drawn, the box says so and the caller's Download button still works.
 */
export function renderPdf(box, blob, title) {
  let task = null, closed = false;
  box.innerHTML = `<div class="d-flex justify-content-center p-5"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading ${esc(title)}…</span></div></div>`;
  (async () => {
    const { getDocument } = await pdfjs();
    if (closed) return;
    task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useWasm: false, enableXfa: false });
    const doc = await task.promise;
    if (closed) return;
    const width = box.clientWidth || 800, ratio = window.devicePixelRatio || 1;
    box.innerHTML = '';
    for (let n = 1; n <= doc.numPages && !closed; n++) {
      const page = await doc.getPage(n);
      const scale = Math.min(MAX_SCALE, width / page.getViewport({ scale: 1 }).width);
      const viewport = page.getViewport({ scale: scale * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      canvas.className = 'pdf-page';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${title}, page ${n} of ${doc.numPages}`);
      box.append(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
    }
  })().catch(() => {
    if (closed) return;
    box.innerHTML = `<div class="p-4 text-center text-body-secondary small" role="alert">${icon('file-earmark-pdf', 'fs-2 d-block mb-2')}This document can’t be shown here. Download it to open it.</div>`;
  });
  return () => { closed = true; task?.destroy(); };
}

import { api } from '../../core/api/client.js';
import { expose } from '../../core/events.js';
import { busy, esc, fail, icon, modal, renderPdf, safeFilename, safeUrl } from '../../shared/ui/index.js';

/* ================= DOCUMENTS ================= */
// Uploaded documents are previewed only as the types the server accepts (PDF, JPEG, PNG). Anything else is re-typed as
// application/octet-stream, so a mislabelled upload (HTML, SVG) can only be downloaded, never rendered in this origin.
const PREVIEW = ['application/pdf', 'image/jpeg', 'image/png'];
/** An object URL for a downloaded document, typed so the browser never renders it as anything but PDF or an image. */
export function documentUrl(blob) {
  const type = PREVIEW.includes(blob.type) ? blob.type : 'application/octet-stream';
  const typed = new Blob([blob], { type });
  return { type, url: URL.createObjectURL(typed), blob: typed };
}
/**
 * Markup previewing a documentUrl(): an image, a box the PDF is drawn into (by mountPreview, once the dialog is open),
 * or a note that it can only be downloaded. PDFs are drawn by the app, not the browser's viewer, which some browsers
 * replace with a download.
 */
export function documentPreview({ type, url }, title, cls = 'h-70vh') {
  if (type.startsWith('image/')) return `<img src="${esc(safeUrl(url, 'blob'))}" alt="${esc(title)}" class="img-fluid d-block mx-auto border rounded">`;
  if (type === 'application/pdf') return `<div class="pdf-view border rounded bg-body-tertiary overflow-auto p-3 ${cls}" data-pdf role="region" aria-label="${esc(title)}" tabindex="0"></div>`;
  return `<div class="border rounded p-4 text-center text-body-secondary small">${icon('file-earmark', 'fs-2 d-block mb-2')}This file can’t be previewed. Download it to open it.</div>`;
}
/** Draws a PDF preview inside the dialog `el` once it is shown (so its width is known); frees it when the dialog closes. */
export function mountPreview(el, doc, title) {
  const box = el.querySelector('[data-pdf]');
  if (!box) return;
  let stop = () => {};
  el.addEventListener('shown.bs.modal', () => { stop = renderPdf(box, doc.blob, title); }, { once: true });
  el.addEventListener('hidden.bs.modal', () => stop());
}

/**
 * Opens a file from the API in a dialog, with a Download button: PDFs and images are shown in the page. A file that
 * cannot be shown (a Word or Excel document in the resource library) is downloaded straight away instead.
 */
export async function showFile(path, title) {
  let res;
  try { res = await api(path, { raw: true }); } catch (e) { return fail(e); }
  const doc = documentUrl(await res.blob());
  const name = safeFilename(/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1], 'document');
  if (doc.type === 'application/octet-stream') { // the object URL just created above, as in download()
    const { url } = doc, a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return;
  }
  const el = modal({
    title: esc(title), size: 'xl', body: documentPreview(doc, title),
    footer: `<a class="btn btn-light me-auto" href="${esc(safeUrl(doc.url, 'blob'))}" download="${esc(name)}">${icon('download', 'me-1')} Download</a><button class="btn btn-light" data-bs-dismiss="modal">Close</button>`,
  });
  mountPreview(el, doc, title);
  el.addEventListener('hidden.bs.modal', () => URL.revokeObjectURL(doc.url));
}
/** For buttons: shows the file (see showFile) with the button busy while it loads. */
export async function viewFile(path, btn, title) {
  busy(btn, true, 'Opening…');
  try { await showFile(path, title); } finally { busy(btn, false); }
}

expose({ viewFile });

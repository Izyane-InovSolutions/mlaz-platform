import { api } from '../../../core/api/client.js';
import { expose } from '../../../core/events.js';
import { esc, fail, icon, modal, safeFilename, safeUrl } from '../../../shared/ui/index.js';

/* ================= DOCUMENTS ================= */
// Uploaded documents are previewed only as the types the server accepts (PDF, JPEG, PNG). Anything else is re-typed as
// application/octet-stream, so a mislabelled upload (HTML, SVG) can only be downloaded, never rendered in this origin.
const PREVIEW = ['application/pdf', 'image/jpeg', 'image/png'];
/** An object URL for a downloaded document, typed so the browser never renders it as anything but PDF or an image. */
export function documentUrl(blob) {
  const type = PREVIEW.includes(blob.type) ? blob.type : 'application/octet-stream';
  return { type, url: URL.createObjectURL(new Blob([blob], { type })) };
}
/** Markup previewing a documentUrl(): an image, a PDF frame, or a note that it can only be downloaded. */
export function documentPreview({ type, url }, title, cls = 'h-70vh') {
  if (type.startsWith('image/')) return `<img src="${esc(safeUrl(url, 'blob'))}" alt="${esc(title)}" class="img-fluid d-block mx-auto border rounded">`;
  if (type === 'application/pdf') return `<iframe src="${esc(safeUrl(url, 'blob'))}" title="${esc(title)}" class="w-100 border rounded ${cls}"></iframe>`;
  return `<div class="border rounded p-4 text-center text-body-secondary small">${icon('file-earmark', 'fs-2 d-block mb-2')}This file can’t be previewed. Download it to open it.</div>`;
}

async function showFile(path, title) {
  let res;
  try { res = await api(path, { raw: true }); } catch (e) { return fail(e); }
  const doc = documentUrl(await res.blob());
  const name = safeFilename(/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1], 'document');
  const el = modal({
    title: esc(title), size: 'xl', body: documentPreview(doc, title),
    footer: `<a class="btn btn-light me-auto" href="${esc(safeUrl(doc.url, 'blob'))}" download="${esc(name)}">${icon('download', 'me-1')} Download</a>${doc.type === 'application/octet-stream' ? '' : `<a class="btn btn-light" href="${esc(safeUrl(doc.url, 'blob'))}" target="_blank" rel="noopener">${icon('box-arrow-up-right', 'me-1')} Open in new tab</a>`}<button class="btn btn-light" data-bs-dismiss="modal">Close</button>`,
  });
  el.addEventListener('hidden.bs.modal', () => URL.revokeObjectURL(doc.url));
}
const viewDoc = (id, title) => showFile(`/admin/documents/${encodeURIComponent(id)}`, title);

expose({ viewDoc });

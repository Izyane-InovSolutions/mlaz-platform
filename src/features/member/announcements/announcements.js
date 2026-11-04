import { EL, on } from '../../../core/events.js';
import { empty, esc, fmtDate, icon, pageHeader } from '../../../shared/ui/index.js';
import { portal } from '../shared/api.js';

/* ================= ANNOUNCEMENTS & RESOURCES ================= */
export async function announcements() {
  const [ann, res] = await Promise.all([portal('/announcements'), portal('/resources')]);
  const groups = res.reduce((g, r) => ((g[r.category] ||= []).push(r), g), {});
  return pageHeader('Announcements', 'Notices and resources from the MLAZ Secretariat')
    + `<div class="row g-3"><div class="col-lg-8"><div class="d-grid gap-3">${ann.map(a => `<div class="card"><div class="card-body"><div class="d-flex gap-2 align-items-center small text-body-secondary mb-1"><span class="badge bg-secondary-subtle text-secondary-emphasis">${esc(a.tag)}</span>${fmtDate(a.publishedAt)}</div><h2 class="h6 fw-semibold mb-1">${esc(a.title)}</h2><p class="small text-body-secondary mb-0 pre-line">${esc(a.body)}</p></div></div>`).join('') || empty('No announcements.')}</div></div>
    <div class="col-lg-4"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Resource library</h2></div><div class="list-group list-group-flush">
      ${Object.entries(groups).map(([cat, items]) => `<div class="list-group-item bg-body-tertiary small fw-semibold">${icon('folder2', 'me-1')}${esc(cat)}</div>`
        + items.map(r => `<div class="list-group-item d-flex align-items-center gap-2 small"><div class="flex-grow-1 min-w-0"><div class="fw-medium text-truncate">${esc(r.title)}</div><div class="text-body-secondary">${fmtDate(r.createdAt)}</div></div>
          <button class="btn btn-sm btn-light" title="Download" ${on('click', 'getFile', `/portal/resources/${encodeURIComponent(r.id)}/download`, EL)}>${icon('download')}</button></div>`).join('')).join('') || empty('No documents yet.', 'folder2')}
    </div></div></div></div>`;
}

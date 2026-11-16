import { getSession } from '../../../core/auth/session-store.js';
import { EL, expose, on } from '../../../core/events.js';
import { busy, esc, fail, fmtDateTime, icon, modal, pageHeader, printDoc } from '../../../shared/ui/index.js';
import { adm } from '../shared/api.js';

/* ================= REPORTS ================= */
const reportTable = ({ cols, rows }) => `<div class="table-responsive"><table class="table table-sm table-hover align-middle small mb-0"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="text-center text-body-secondary py-4">No records.</td></tr>`}</tbody></table></div>`;
export async function reports() {
  const list = await adm('/reports');
  return pageHeader('Reports', 'Standard reports with export to Excel (CSV) and PDF')
    + `<div class="row g-3">${list.map(rp => `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
      <div class="d-flex gap-3 mb-2"><span class="icon-circle bg-primary-subtle text-primary-emphasis">${icon(rp.icon)}</span><div><h2 class="h6 fw-semibold mb-1">${esc(rp.title)}</h2><div class="small text-body-secondary">${esc(rp.description)}</div></div></div>
      <div class="d-flex gap-2 mt-auto pt-3"><button class="btn btn-sm btn-outline-secondary flex-grow-1" ${on('click', 'viewReport', rp.key, EL)}>${icon('eye', 'me-1')} View</button>
        <button class="btn btn-sm btn-outline-secondary" ${on('click', 'getFile', `/admin/reports/${encodeURIComponent(rp.key)}?format=csv`, EL)} title="Opens in Excel">${icon('file-earmark-spreadsheet', 'me-1')} Excel</button>
        <button class="btn btn-sm btn-outline-secondary" ${on('click', 'reportPdf', rp.key, EL)}>${icon('file-earmark-pdf', 'me-1')} PDF</button></div>
    </div></div></div>`).join('')}</div>`;
}
async function viewReport(key, btn) {
  busy(btn, true, 'Loading…');
  try {
    const r = await adm(`/reports/${encodeURIComponent(key)}`);
    modal({ title: esc(r.title), size: 'xl', body: `<div class="small text-body-secondary mb-2">${Number(r.rows.length)} rows · generated ${fmtDateTime(r.generatedAt)}</div>${reportTable(r)}`,
      footer: `<button class="btn btn-light me-auto" data-bs-dismiss="modal">Close</button><button class="btn btn-outline-secondary" ${on('click', 'getFile', `/admin/reports/${encodeURIComponent(key)}?format=csv`, EL)}>${icon('file-earmark-spreadsheet', 'me-1')} Excel</button><button class="btn btn-primary" ${on('click', 'reportPdf', key, EL)}>${icon('file-earmark-pdf', 'me-1')} PDF</button>` });
  } catch (e) { fail(e); } finally { busy(btn, false); }
}
async function reportPdf(key, btn) {
  busy(btn, true, 'Preparing…');
  try {
    const r = await adm(`/reports/${encodeURIComponent(key)}`), st = getSession();
    printDoc(`MLAZ · ${r.title}`, `<div class="eyebrow">MONEY LENDERS ASSOCIATION OF ZAMBIA</div><h1 class="h4 mt-1">${esc(r.title)}</h1>
      <p class="small text-body-secondary">Generated ${fmtDateTime(r.generatedAt)}${st?.name ? ` by ${esc(st.name)}` : ''} · ${r.rows.length} rows</p>${reportTable(r)}`);
  } catch (e) { fail(e); } finally { busy(btn, false); }
}

expose({ viewReport, reportPdf });

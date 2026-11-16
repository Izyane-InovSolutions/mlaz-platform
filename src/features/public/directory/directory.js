import { pub } from '../../../core/api/client.js';
import { publicConfig } from '../../../core/reference-data.js';
import { expose, on } from '../../../core/events.js';
import { after } from '../../../core/navigation.js';
import { avatar, empty, esc, icon, note as alertBox } from '../../../shared/ui/index.js';
import { tierBadge } from '../../common/index.js';
import { tiersByPrice } from '../shared/tiers.js';

const DIR_PAGE = 24;
let dir = { page: 1, items: [], total: 0 }, dirTimer = null, dirSeq = 0;

export async function directory() {
  const cfg = await publicConfig();
  dir = { page: 1, items: [], total: 0 };
  after(() => loadDirectory());
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container">
    <h1 class="h2 fw-bold mb-1">Member directory</h1><p class="text-body-secondary">Accredited money lenders in good standing with MLAZ.</p>
    <div class="row g-2 mb-4">
      <div class="col-md-6"><div class="input-group"><span class="input-group-text bg-white">${icon('search')}</span><input class="form-control" id="dirq" type="search" aria-label="Search the member directory by name, town or member number" placeholder="Search by name, town or member number" ${on('input', 'filterDirectory')}></div></div>
      <div class="col-6 col-md-3"><select class="form-select" id="dirprov" aria-label="Filter by province" ${on('change', 'filterDirectory')}><option value="">All provinces</option>${cfg.provinces.map(p => `<option>${esc(p)}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><select class="form-select" id="dirtier" aria-label="Filter by tier" ${on('change', 'filterDirectory')}><option value="">All tiers</option>${tiersByPrice(cfg).map(t => `<option>${esc(t.name)}</option>`).join('')}</select></div></div>
    <div class="row g-3" id="dirlist"><div class="col-12 text-center py-5"><div class="spinner-border text-primary" role="status"></div></div></div>
    <div class="text-center mt-4" id="dirmore"></div></div></section>`;
}

function filterDirectory() { clearTimeout(dirTimer); dirTimer = setTimeout(() => loadDirectory(), 250); }

async function loadDirectory(more = false) {
  const list = document.getElementById('dirlist'); if (!list) return;
  const seq = ++dirSeq, page = more ? dir.page + 1 : 1;
  const params = new URLSearchParams({ page, pageSize: DIR_PAGE });
  const q = document.getElementById('dirq').value.trim(), province = document.getElementById('dirprov').value, tier = document.getElementById('dirtier').value;
  if (q) params.set('q', q);
  if (province) params.set('province', province);
  if (tier) params.set('tier', tier);
  try {
    const r = await pub(`/directory?${params}`);
    if (seq !== dirSeq) return; // a newer search has started
    dir = { page, total: r.total, items: more ? [...dir.items, ...r.items] : r.items };
  } catch (e) {
    if (seq !== dirSeq) return;
    list.innerHTML = `<div class="col-12">${alertBox('danger', 'exclamation-circle', `${esc(e.message)} <a href="#" role="button" ${on('click', 'filterDirectory')}>Try again</a>.`)}</div>`;
    return;
  }
  list.innerHTML = dir.items.map((m, i) => `<div class="col-md-6 col-lg-4"><div class="card h-100"><div class="card-body">
    <div class="d-flex gap-3 align-items-center mb-3">${avatar(m.name, i)}<div class="min-w-0"><div class="fw-semibold text-truncate">${esc(m.name)}</div><div class="small text-body-secondary">${esc(m.town)}, ${esc(m.province)}</div></div></div>
    <div class="d-flex justify-content-between small mb-3"><span class="text-body-secondary">${esc(m.number)}</span>${tierBadge(m.tier)}</div>
    <div class="d-flex justify-content-between align-items-center"><span class="small text-success-emphasis">${icon('patch-check-fill', 'me-1')}Accredited</span><a href="#/verify/${encodeURIComponent(m.number)}" class="btn btn-sm btn-outline-primary">Verify</a></div>
  </div></div></div>`).join('') || `<div class="col-12">${empty('No members match your search.', 'search')}</div>`;
  document.getElementById('dirmore').innerHTML = dir.items.length < dir.total
    ? `<div class="small text-body-secondary mb-2">Showing ${dir.items.length} of ${dir.total}</div><button class="btn btn-outline-secondary" ${on('click', 'loadDirectory', true)}>Show more</button>`
    : dir.total ? `<div class="small text-body-secondary">${dir.total} member${dir.total === 1 ? '' : 's'}</div>` : '';
}

expose({ filterDirectory, loadDirectory });

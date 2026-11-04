import { on } from '../../core/events.js';
import { empty } from './components.js';

const tableCard = (head, rows, emptyText, footer = '') => `<div class="card"><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr>${head.map(h => `<th class="${h.startsWith('#') ? 'text-end' : ''}">${h.replace('#', '')}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}">${empty(emptyText)}</td></tr>`}</tbody></table></div>${footer}</div>`;
const pills = (items, active, fn) => `<ul class="nav nav-pills small mb-3 gap-1">${items.map(([k, l]) => `<li class="nav-item"><a class="nav-link ${active === k ? 'active' : ''}" href="#" role="button" ${on('click', fn, k)}>${l}</a></li>`).join('')}</ul>`;
function pager(r, fn) {
  if (!r.total) return '';
  const from = (r.page - 1) * r.pageSize + 1, to = Math.min(r.total, r.page * r.pageSize);
  return `<div class="card-footer bg-white d-flex justify-content-between align-items-center small"><span class="text-body-secondary">${from}–${to} of ${r.total}</span>
    ${r.total > r.pageSize ? `<div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" ${r.page <= 1 ? 'disabled' : ''} ${on('click', fn, r.page - 1)}>Previous</button><button class="btn btn-outline-secondary" ${to >= r.total ? 'disabled' : ''} ${on('click', fn, r.page + 1)}>Next</button></div>` : ''}</div>`;
}

export { pager, pills, tableCard };

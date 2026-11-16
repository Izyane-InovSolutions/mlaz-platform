import { can } from '../../../core/auth/permissions.js';
import { esc, icon } from '../../../shared/ui/index.js';
import { adm } from '../shared/api.js';

/* ================= SEARCH ================= */
export async function adminSearch(q) {
  q = q.trim();
  if (q.length < 2) return '';
  const r = await adm(`/search?q=${encodeURIComponent(q)}`);
  const hits = [
    ...r.members.map(m => `<a class="dropdown-item py-2" href="#/app/members/${esc(m.number)}">${icon('person', 'me-2 text-body-secondary')}${esc(m.name)} <span class="small text-body-secondary">${esc(m.number)}</span></a>`),
    ...(can('applications:read') ? r.applications.map(a => `<a class="dropdown-item py-2" href="#/app/applications/${esc(a.ref)}">${icon('file-earmark-text', 'me-2 text-body-secondary')}${esc(a.businessName)} <span class="small text-body-secondary">${esc(a.ref)}</span></a>`) : []),
  ];
  return hits.slice(0, 10).join('') || '<span class="dropdown-item-text small text-body-secondary">No matches</span>';
}

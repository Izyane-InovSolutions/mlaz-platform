import { EL, expose, on } from '../../../core/events.js';
import { rerender } from '../../../core/navigation.js';
import { avatar, esc, icon, lower, pageHeader, pager, pills, tableCard } from '../../../shared/ui/index.js';
import { accredBadge, mofBadge, statusBadge, tierBadge } from '../../common/index.js';
import { adm, qs } from '../shared/api.js';
import { searchBox } from '../shared/ui.js';
import { memberDetail } from './detail.js';

/* ================= MEMBERS ================= */
const MTABS = [['all', 'All', {}], ['active', 'Active', { status: 'ACTIVE' }], ['lapsed', 'Lapsed', { status: 'LAPSED' }], ['suspended', 'Suspended', { status: 'SUSPENDED' }], ['dues', 'Dues due', { filter: 'dues_due' }], ['mof', 'MoF expired', { filter: 'mof_expired' }]];
let MS = { tab: 'all', q: '', page: 1 };
const setMTab = k => { MS = { ...MS, tab: k, page: 1 }; rerender(); };
const setMQuery = q => { MS = { ...MS, q, page: 1 }; rerender(); };
const setMPage = p => { MS.page = p; rerender(); };

export async function members(number) {
  if (number) return memberDetail(number);
  const tab = MTABS.find(t => t[0] === MS.tab);
  const r = await adm(`/members${qs({ ...tab[2], q: MS.q, page: MS.page, pageSize: 25 })}`);
  return pageHeader('Members', 'Accredited lenders, their MoF authorization, accreditation and dues',
    `<button class="btn btn-outline-secondary" ${on('click', 'getFile', '/admin/members/export.csv', EL)}>${icon('download', 'me-1')} Export CSV</button><a class="btn btn-primary" href="#/apply" target="_blank">${icon('plus-lg', 'me-1')} New application</a>`)
    + searchBox(MS.q, 'setMQuery', 'Search by name, member number, town or TPIN')
    + pills(MTABS.map(([k, l]) => [k, l]), MS.tab, 'setMTab')
    + tableCard(['Member', 'Member no.', 'Town', 'Tier', 'MoF', 'Accreditation', 'Dues', 'Status'], r.items.map((m, i) => `<tr class="clickable" ${on('click', 'nav', `app/members/${encodeURIComponent(m.number)}`)}>
      <td><div class="d-flex align-items-center gap-2">${avatar(m.name, i)}<div><div class="fw-medium">${esc(m.name)}</div><div class="small text-body-secondary">${esc(m.contactName)}</div></div></div></td>
      <td class="small font-monospace">${esc(m.number)}</td><td>${esc(m.town)}</td><td>${tierBadge(m.tier)}</td><td>${mofBadge(lower(m.mofStatus))}</td><td>${accredBadge(lower(m.accreditation))}</td>
      <td>${m.duesDue ? '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle">Due</span>' : '<span class="badge rounded-pill bg-success-subtle text-success-emphasis border border-success-subtle">Paid</span>'}</td><td>${statusBadge(lower(m.status))}</td></tr>`).join(''),
    MS.q ? 'No members match your search.' : 'No members match this filter.', pager(r, 'setMPage'));
}

expose({ setMTab, setMQuery, setMPage });

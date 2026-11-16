import { expose, on } from '../../../core/events.js';
import { rerender } from '../../../core/navigation.js';
import { esc, icon, note, pageHeader, pager, tableCard } from '../../../shared/ui/index.js';
import { tierBadge } from '../../common/index.js';
import { adm, qs } from '../shared/api.js';

/* ================= PUBLIC DIRECTORY ================= */
let DIR_PAGE = 1;
const setDirPage = p => { DIR_PAGE = p; rerender(); };
export async function directory() {
  const r = await adm(`/members${qs({ page: DIR_PAGE, pageSize: 50 })}`);
  return pageHeader('Public directory', 'What borrowers and regulators see when they verify a member', `<a class="btn btn-outline-secondary" href="#/directory" target="_blank">${icon('box-arrow-up-right', 'me-1')} Open public directory</a>`)
    + note('light border', 'info-circle', 'Only <b>active, accredited</b> members with a valid MoF authorization and paid dues are listed publicly and pass verification. The listing updates automatically.')
    + tableCard(['Member', 'Member no.', 'Town', 'Tier', 'Public listing'], r.items.map(m => `<tr class="clickable" ${on('click', 'nav', `app/members/${encodeURIComponent(m.number)}`)}><td class="fw-medium">${esc(m.name)}</td><td class="small font-monospace">${esc(m.number)}</td><td>${esc(m.town)}</td><td>${tierBadge(m.tier)}</td>
      <td>${m.goodStanding ? '<span class="badge bg-success-subtle text-success-emphasis">Listed</span>' : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Hidden</span>'}</td></tr>`).join(''), 'No members yet.', pager(r, 'setDirPage'));
}

expose({ setDirPage });

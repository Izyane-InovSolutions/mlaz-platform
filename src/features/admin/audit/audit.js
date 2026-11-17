import { rerender } from '../../../core/navigation.js';
import { EL, expose, on } from '../../../core/events.js';
import { esc, fmtDateTime, pageHeader, pager, tableCard } from '../../../shared/ui/index.js';
import { adm, qs } from '../shared/api.js';
import { searchBox } from '../shared/ui.js';

const AUDIT = { actorType: '', q: '', page: 1 };
const setAuditType = select => { AUDIT.actorType = select.value; AUDIT.page = 1; rerender(); };
const setAuditQuery = q => { AUDIT.q = q; AUDIT.page = 1; rerender(); };
const setAuditLogPage = page => { AUDIT.page = page; rerender(); };

export async function audit() {
  const result = await adm(`/audit${qs({ actorType: AUDIT.actorType, q: AUDIT.q, page: AUDIT.page, pageSize: 25 })}`);
  const header = `<div class="card-header bg-white d-flex flex-wrap align-items-center gap-2 py-2">
    <div class="d-flex align-items-center gap-2"><label class="small text-body-secondary mb-0" for="audit-type-filter">User type</label>
      <select class="form-select form-select-sm w-auto" id="audit-type-filter" aria-label="Filter audit trail by user type" ${on('change', 'setAuditType', EL)}>
        <option value="">All types</option><option value="STAFF" ${AUDIT.actorType === 'STAFF' ? 'selected' : ''}>Secretariat</option>
        <option value="MEMBER" ${AUDIT.actorType === 'MEMBER' ? 'selected' : ''}>Member</option><option value="APPLICANT" ${AUDIT.actorType === 'APPLICANT' ? 'selected' : ''}>Applicant</option>
        <option value="SYSTEM" ${AUDIT.actorType === 'SYSTEM' ? 'selected' : ''}>System</option></select></div>
    ${searchBox(AUDIT.q, 'setAuditQuery', 'Search users, records, actions or details', 'ms-auto flex-grow-1 mw-420')}</div>`;
  const rows = result.items.map(entry => `<tr><td class="text-nowrap">${fmtDateTime(entry.at)}</td><td>${esc(entry.actorLabel)}</td><td>${esc(entry.target)}</td><td>${esc(entry.action)}</td><td>${esc(entry.note || '—')}</td></tr>`).join('');
  return pageHeader('Audit trail', 'User activity and changes recorded across the console')
    + tableCard(['Date & time', 'User', 'Record', 'Action', 'Details'], rows,
      AUDIT.q || AUDIT.actorType ? 'No audit entries match your search or filter.' : 'No audit entries recorded.',
      pager(result, 'setAuditLogPage'), header);
}

expose({ setAuditType, setAuditQuery, setAuditLogPage });

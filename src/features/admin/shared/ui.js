// Console-wide pieces: breadcrumbs, search boxes, payment rows, audit trails and labels used by several pages.
import { can } from '../../../core/auth/permissions.js';
import { EL, expose, invoke, on } from '../../../core/events.js';
import { K, empty, esc, fmtDateTime, icon, listItem, lower, pager } from '../../../shared/ui/index.js';
import { payBadge, stageBadge } from '../../common/index.js';

const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const appBadge = a => stageBadge(a.displayStage === 'AWAITING_APPROVAL' ? 'mof_approval' : lower(a.stage));
const crumb = (href, label, current) => `<li class="breadcrumb-item"><a href="#/app/${encodeURIComponent(href)}">${label}</a></li><li class="breadcrumb-item active">${esc(current)}</li>`;
const searchBox = (value, fn, ph) => `<form class="mb-3 mw-420" ${on('submit', 'runSearch', fn, EL)}><div class="input-group"><span class="input-group-text bg-white">${icon('search')}</span><input class="form-control" type="search" name="q" value="${esc(value)}" aria-label="${ph}" placeholder="${ph}">${value ? `<button class="btn btn-outline-secondary" type="button" ${on('click', fn, '')}>Clear</button>` : ''}</div></form>`;
// The search boxes above name one of these setters (registered by the list pages); the form gives the query. Only
// these names can be run this way.
const SEARCH_SETTERS = ['setMQuery', 'setAQuery', 'setPQuery', 'setCQuery'];
const runSearch = (fn, form) => { if (SEARCH_SETTERS.includes(fn)) invoke(fn, form.q.value.trim()); };
const DOC_KIND = { MOF_AUTHORIZATION: 'Ministry of Finance authorization', PACRA_CERTIFICATE: 'PACRA certificate of incorporation', DIRECTOR_NRC: 'Director’s NRC', PROOF_OF_PAYMENT: 'Proof of payment', RESOURCE: 'Resource' };

// The detail pages load the whole trail with the record, so it is paged here in the browser, five entries at a time.
// A page shows one audit card, so the rows it was drawn from are kept for the pager to redraw it in place.
const AUDIT_PAGE_SIZE = 5;
let AUDIT_ROWS = [];
function auditCard(rows, page = 1) {
  AUDIT_ROWS = rows;
  const pages = Math.max(1, Math.ceil(rows.length / AUDIT_PAGE_SIZE));
  page = Math.min(Math.max(1, page), pages);
  const shown = rows.slice((page - 1) * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE);
  return `<div class="card mt-3" id="audit-trail"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Audit trail</h2><span class="ms-auto small text-body-secondary">Every decision, with user and time</span></div><div class="list-group list-group-flush">
  ${shown.map(x => listItem('clock-history', 'secondary', esc(x.action), `${esc(x.actorLabel)} · ${fmtDateTime(x.at)}${x.note ? ` · ${esc(x.note)}` : ''}`)).join('') || empty('No recorded activity yet.', 'clock-history')}
</div>${pager({ total: rows.length, page, pageSize: AUDIT_PAGE_SIZE }, 'setAuditPage')}</div>`;
}
const setAuditPage = page => {
  const card = document.getElementById('audit-trail');
  if (card) card.outerHTML = auditCard(AUDIT_ROWS, page);
};

const payDesc = p => esc(p.event ? `${p.event.name} (${p.event.tickets} ticket${p.event.tickets === 1 ? '' : 's'})` : p.lines.map(l => l.description).join(' · '));
function paymentRow(p, { payer = true } = {}) {
  const review = p.status === 'PENDING' && p.method === 'BANK_TRANSFER' && p.hasProof && can('payments:confirm');
  const action = review ? `<button class="btn btn-sm btn-outline-primary text-nowrap" ${on('click', 'reviewPayment', p.ref)}>Review PoP</button>`
    : p.status === 'SUCCESS' ? `<button class="btn btn-sm btn-light" title="Receipt" ${on('click', 'viewFile', `/admin/payments/${encodeURIComponent(p.ref)}/receipt.pdf`, EL, `Receipt · ${p.ref}`)}>${icon('receipt')}</button>`
      : p.status === 'PENDING' && p.method === 'BANK_TRANSFER' && !p.hasProof ? '<span class="small text-body-secondary">Awaiting proof</span>' : '';
  return `<tr><td class="small font-monospace">${esc(p.ref)}</td>
    ${payer ? `<td><div class="fw-medium">${esc(p.payerName)}</div><div class="small text-body-secondary">${fmtDateTime(p.createdAt)}${p.memberNumber ? ` · <a href="#/app/members/${esc(p.memberNumber)}">${esc(p.memberNumber)}</a>` : p.applicationRef ? ` · <a href="#/app/applications/${esc(p.applicationRef)}">${esc(p.applicationRef)}</a>` : ''}</div></td>` : `<td class="small">${fmtDateTime(p.createdAt)}</td>`}
    <td class="small">${payDesc(p)}${p.failureReason && p.status !== 'SUCCESS' ? `<div class="text-body-secondary">${esc(p.failureReason)}</div>` : ''}</td>
    <td class="small">${esc(p.methodLabel)}${p.bankRef ? `<div class="text-body-secondary">ref ${esc(p.bankRef)}</div>` : ''}</td>
    <td class="text-end fw-medium text-nowrap">${K(p.amount)}</td><td>${payBadge(lower(p.status))}</td><td class="text-end">${action}</td></tr>`;
}

const offlineFields = (refLabel = 'Bank reference or receipt number') => `<div class="row g-3"><div class="col-6"><label class="form-label small fw-medium">Method</label><select class="form-select" name="method"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option></select></div>
  <div class="col-6"><label class="form-label small fw-medium">${refLabel}</label><input class="form-control" name="reference" required placeholder="e.g. FT26285ABC12"><div class="invalid-feedback">Required.</div></div></div>`;

export { DOC_KIND, appBadge, auditCard, crumb, offlineFields, paymentRow, searchBox, tomorrow };

expose({ runSearch, setAuditPage });

import {
  esc, K, KM, fmtDate, fmtDateTime, today, icon, avatar, statusBadge, tierBadge, accredBadge, mofBadge, payBadge, stageBadge,
  pageHeader, statCard, stepper, empty, listItem, toast, modal, asyncModal, nav, rerender, expose, printDoc, busy, getSession, jsArg,
} from './ui.js';
import { api, can, download, publicConfig } from './api.js';
import { accountCard } from './security.js';

// Secretariat console. Every page loads from the API (/api/admin) and every action goes through it; buttons a role
// may not use are hidden, and the server enforces the same permissions regardless.

const adm = (path, opts) => api(`/admin${path}`, opts);
const lower = s => String(s || '').toLowerCase();
const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); }); const s = p.toString(); return s ? `?${s}` : ''; };
const done = msg => { toast(msg); rerender(); };
const fail = e => toast(e.message, 'error');
const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const appBadge = a => stageBadge(a.displayStage === 'AWAITING_APPROVAL' ? 'mof_approval' : lower(a.stage));
const note = (tone, ic, html, cls = '') => `<div class="alert alert-${tone} small d-flex gap-2 ${cls}">${icon(ic)}<div>${html}</div></div>`;
const info = (k, v) => `<div class="d-flex justify-content-between gap-3 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v ?? '—'}</span></div>`;
const crumb = (href, label, current) => `<li class="breadcrumb-item"><a href="#/app/${href}">${label}</a></li><li class="breadcrumb-item active">${esc(current)}</li>`;
const tableCard = (head, rows, emptyText, footer = '') => `<div class="card"><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr>${head.map(h => `<th class="${h.startsWith('#') ? 'text-end' : ''}">${h.replace('#', '')}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}">${empty(emptyText)}</td></tr>`}</tbody></table></div>${footer}</div>`;
const pills = (items, active, fn) => `<ul class="nav nav-pills small mb-3 gap-1">${items.map(([k, l]) => `<li class="nav-item"><a class="nav-link ${active === k ? 'active' : ''}" href="javascript:void 0" onclick="${fn}('${k}')">${l}</a></li>`).join('')}</ul>`;
const searchBox = (value, fn, ph) => `<form class="mb-3" style="max-width:420px" onsubmit="event.preventDefault();${fn}(this.q.value.trim())"><div class="input-group"><span class="input-group-text bg-white">${icon('search')}</span><input class="form-control" name="q" value="${esc(value)}" placeholder="${ph}">${value ? `<button class="btn btn-outline-secondary" type="button" onclick="${fn}('')">Clear</button>` : ''}</div></form>`;
function pager(r, fn) {
  if (!r.total) return '';
  const from = (r.page - 1) * r.pageSize + 1, to = Math.min(r.total, r.page * r.pageSize);
  return `<div class="card-footer bg-white d-flex justify-content-between align-items-center small"><span class="text-body-secondary">${from}–${to} of ${r.total}</span>
    ${r.total > r.pageSize ? `<div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" ${r.page <= 1 ? 'disabled' : ''} onclick="${fn}(${r.page - 1})">Previous</button><button class="btn btn-outline-secondary" ${to >= r.total ? 'disabled' : ''} onclick="${fn}(${r.page + 1})">Next</button></div>` : ''}</div>`;
}
const DOC_KIND = { MOF_AUTHORIZATION: 'Ministry of Finance authorization', PACRA_CERTIFICATE: 'PACRA certificate of incorporation', DIRECTOR_NRC: 'Director’s NRC', PROOF_OF_PAYMENT: 'Proof of payment', RESOURCE: 'Resource' };
const EVENT_TYPE = { TRAINING: 'Training', WEBINAR: 'Webinar', AGM: 'AGM', NETWORKING: 'Networking' };

/* ================= SIDEBAR ================= */
// Badge counts come from a cheap endpoint the router refreshes on every console page.
let NAV = { openApplications: 0, mofToVerify: 0, awaitingApproval: 0, bankTransfers: 0 };
export async function refreshNavCounts() { try { NAV = await adm('/nav-counts'); } catch (e) { /* keep the last counts */ } }

// [id, label, icon, badge, permission needed to see the page]
export const ADMIN_NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'grid-1x2', null, 'dashboard:view'], ['reports', 'Reports', 'file-earmark-bar-graph', null, 'reports:read']]],
  ['Membership', [['members', 'Members', 'people', null, 'members:read'], ['applications', 'Applications', 'file-earmark-text', () => NAV.openApplications, 'applications:read'], ['certificates', 'Certificates', 'award', () => NAV.mofToVerify, 'members:read']]],
  ['Finance', [['payments', 'Payments & dues', 'credit-card', () => NAV.bankTransfers, 'payments:read']]],
  ['Engage', [['communications', 'Communications', 'megaphone'], ['events', 'Events', 'calendar-event', null, 'events:read'], ['directory', 'Public directory', 'globe', null, 'members:read']]],
  ['Configure', [['settings', 'Settings', 'gear']]],
];
export const ADMIN_PAGE_PERM = Object.fromEntries(ADMIN_NAV.flatMap(([, items]) => items.map(i => [i[0], i[4]])));

/* ================= DOCUMENTS ================= */
async function showFile(path, title) {
  let res;
  try { res = await api(path, { raw: true }); } catch (e) { return fail(e); }
  const blob = await res.blob(), url = URL.createObjectURL(blob);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'document';
  const body = blob.type.startsWith('image/') ? `<img src="${url}" alt="${esc(title)}" class="img-fluid d-block mx-auto border rounded">`
    : `<iframe src="${url}" title="${esc(title)}" class="w-100 border rounded" style="height:70vh"></iframe>`;
  const el = modal({
    title: esc(title), size: 'xl', body,
    footer: `<a class="btn btn-light me-auto" href="${url}" download="${esc(name)}">${icon('download', 'me-1')} Download</a><a class="btn btn-light" href="${url}" target="_blank" rel="noopener">${icon('box-arrow-up-right', 'me-1')} Open in new tab</a><button class="btn btn-light" data-bs-dismiss="modal">Close</button>`,
  });
  el.addEventListener('hidden.bs.modal', () => URL.revokeObjectURL(url));
}
const viewDoc = (id, title) => showFile(`/admin/documents/${id}`, title);
async function getFile(path, btn) {
  busy(btn, true, 'Preparing…');
  try { await download(path); } catch (e) { fail(e); } finally { busy(btn, false); }
}

const auditCard = rows => `<div class="card mt-3"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Audit trail</h2><span class="ms-auto small text-body-secondary">Every decision, with user and time</span></div><div class="list-group list-group-flush">
  ${rows.map(x => listItem('clock-history', 'secondary', esc(x.action), `${esc(x.actorLabel)} · ${fmtDateTime(x.at)}${x.note ? ` · ${esc(x.note)}` : ''}`)).join('') || empty('No recorded activity yet.', 'clock-history')}
</div></div>`;

const payDesc = p => esc(p.event ? `${p.event.name} (${p.event.tickets} ticket${p.event.tickets === 1 ? '' : 's'})` : p.lines.map(l => l.description).join(' · '));
function paymentRow(p, { payer = true } = {}) {
  const review = p.status === 'PENDING' && p.method === 'BANK_TRANSFER' && p.hasProof && can('payments:confirm');
  const action = review ? `<button class="btn btn-sm btn-outline-primary text-nowrap" onclick="reviewPayment(${jsArg(p.ref)})">Review PoP</button>`
    : p.status === 'SUCCESS' ? `<button class="btn btn-sm btn-light" title="Receipt" onclick="getFile('/admin/payments/${esc(p.ref)}/receipt.pdf',this)">${icon('receipt')}</button>`
      : p.status === 'PENDING' && p.method === 'BANK_TRANSFER' && !p.hasProof ? '<span class="small text-body-secondary">Awaiting proof</span>' : '';
  return `<tr><td class="small font-monospace">${esc(p.ref)}</td>
    ${payer ? `<td><div class="fw-medium">${esc(p.payerName)}</div><div class="small text-body-secondary">${fmtDateTime(p.createdAt)}${p.memberNumber ? ` · <a href="#/app/members/${esc(p.memberNumber)}">${esc(p.memberNumber)}</a>` : p.applicationRef ? ` · <a href="#/app/applications/${esc(p.applicationRef)}">${esc(p.applicationRef)}</a>` : ''}</div></td>` : `<td class="small">${fmtDateTime(p.createdAt)}</td>`}
    <td class="small">${payDesc(p)}${p.failureReason && p.status !== 'SUCCESS' ? `<div class="text-body-secondary">${esc(p.failureReason)}</div>` : ''}</td>
    <td class="small">${esc(p.methodLabel)}${p.bankRef ? `<div class="text-body-secondary">ref ${esc(p.bankRef)}</div>` : ''}</td>
    <td class="text-end fw-medium text-nowrap">${K(p.amount)}</td><td>${payBadge(lower(p.status))}</td><td class="text-end">${action}</td></tr>`;
}

/* ================= DASHBOARD ================= */
const ATTENTION = {
  mof_to_verify: ['file-earmark-check', 'warning', t => `nav(${jsArg(`app/applications/${t}`)})`, 'Review'],
  awaiting_your_approval: ['person-check', 'primary', t => `nav(${jsArg(`app/applications/${t}`)})`, 'Review'],
  renewal_to_verify: ['file-earmark-check', 'warning', t => `nav(${jsArg(`app/members/${t}`)})`, 'Review'],
  bank_transfer_to_confirm: ['bank', 'info', t => `reviewPayment(${jsArg(t)})`, 'Review'],
  member_lapsed: ['hourglass-bottom', 'warning', t => `nav(${jsArg(`app/members/${t}`)})`, 'View'],
  member_suspended: ['exclamation-octagon', 'danger', t => `nav(${jsArg(`app/members/${t}`)})`, 'View'],
};

async function dashboard() {
  const [d, cfg] = await Promise.all([adm('/dashboard'), publicConfig()]);
  const s = d.stats;
  const attention = d.attention.map(a => {
    const [ic, tone, go, label] = ATTENTION[a.kind] || ['info-circle', 'secondary', t => `nav(${jsArg(`app/members/${t}`)})`, 'View'];
    return listItem(ic, tone, esc(a.title), esc(a.detail), `<button class="btn btn-sm btn-outline-secondary" onclick="${go(a.target)}">${label}</button>`);
  });
  if (s.duesDue && can('comms:write')) attention.push(listItem('envelope', 'info', `${s.duesDue} member${s.duesDue === 1 ? '' : 's'} with dues due`, 'Send a renewal reminder', '<button class="btn btn-sm btn-outline-secondary" onclick="broadcast(\'DUES_DUE\')">Notify</button>'));
  return pageHeader('Dashboard', `Overview as at ${fmtDate(d.asAt)}`,
    `${can('members:read') ? `<button class="btn btn-outline-secondary" onclick="getFile('/admin/members/export.csv',this)">${icon('download', 'me-1')} Export members</button>` : ''}${can('applications:read') ? `<a class="btn btn-primary" href="#/app/applications">${icon('file-earmark-text', 'me-1')} Review applications</a>` : ''}`)
    // The server leaves out (null) figures this role may not see; only the rest are shown.
    + `<div class="row g-3 mb-4">${[
      statCard('Total members', s.totalMembers, `${s.lapsedOrSuspended} lapsed or suspended`, 'people', 'primary'),
      statCard('Active & accredited', s.accredited, `${s.accreditedShare}% of members`, 'patch-check', 'success'),
      statCard('Dues due', s.duesDue, 'payable now or overdue', 'hourglass-split', 'warning'),
      s.collectedYtd !== null && statCard('Collected (YTD)', KM(s.collectedYtd), 'successful payments this year', 'cash-stack', 'info'),
      s.openApplications !== null && statCard('Open applications', s.openApplications, 'in the pipeline', 'inboxes', 'secondary'),
      statCard('MoF documents to verify', s.mofToVerify, s.awaitingApproval !== null ? `new & renewals · ${s.awaitingApproval} awaiting approval` : 'renewals', 'file-earmark-check', 'warning'),
      s.awaitingPayment !== null && statCard('Awaiting payment', s.awaitingPayment, 'certificate issues on payment', 'credit-card', 'success'),
      statCard('Lapsed / suspended', s.lapsedOrSuspended, 'need follow-up', 'exclamation-octagon', 'danger'),
    ].filter(Boolean).map(c => `<div class="col-sm-6 col-xl-3">${c}</div>`).join('')}</div>
    <div class="row g-3 mb-4">
      <div class="col-xl-6"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Membership growth</h2><span class="ms-auto small text-body-secondary">Last 6 months</span></div><div class="card-body">${growthChart(d.growth)}</div></div></div>
      <div class="col-md-6 col-xl-3"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Members by tier</h2></div><div class="card-body">${tierBars(d.tiers, cfg.tiers)}</div></div></div>
      <div class="col-md-6 col-xl-3"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Members by region</h2></div><div class="card-body">${regionBars(d.regions)}</div></div></div>
    </div>
    <div class="row g-3">
      <div class="col-lg-7"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Onboarding pipeline</h2>${can('applications:read') ? '<a class="ms-auto small" href="#/app/applications">View all</a>' : ''}</div>
        ${d.pipeline.length ? `<div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Applicant</th><th>Town</th><th>Stage</th><th>Submitted</th></tr></thead><tbody>
        ${d.pipeline.map(a => `<tr class="${can('applications:read') ? 'clickable' : ''}" ${can('applications:read') ? `onclick="nav('app/applications/${esc(a.ref)}')"` : ''}><td class="fw-medium">${esc(a.businessName)}</td><td>${esc(a.town)}</td><td>${appBadge(a)}</td><td class="small text-body-secondary">${fmtDate(a.submittedAt)}</td></tr>`).join('')}</tbody></table></div>` : empty('No open applications.')}
      </div></div>
      <div class="col-lg-5"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Needs attention</h2></div>
        <div class="list-group list-group-flush">${attention.join('') || empty("You're all caught up.", 'check2-circle')}</div>
      </div></div>
    </div>`;
}
function growthChart(points) {
  const d = points.map(p => p.members), lab = points.map(p => new Date(`${p.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }));
  const lo = Math.min(...d), hi = Math.max(...d), min = lo - Math.max(2, (hi - lo) * 0.2), max = hi + Math.max(2, (hi - lo) * 0.1), W = 560, H = 210, pad = 30;
  const pts = d.map((v, i) => [pad + i * ((W - 2 * pad) / (d.length - 1)), H - 24 - ((v - min) / (max - min)) * (H - 54)]);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(0) + ' ' + p[1].toFixed(0)).join(' ');
  const area = path + ` L ${pts[pts.length - 1][0]} ${H - 24} L ${pts[0][0]} ${H - 24} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Membership growth chart">
    ${[0, 1, 2, 3].map(i => `<line x1="${pad}" x2="${W - pad}" y1="${30 + i * ((H - 54) / 3)}" y2="${30 + i * ((H - 54) / 3)}" stroke="#eef1f5"/>`).join('')}
    <path d="${area}" fill="rgba(11,94,59,.08)"/><path d="${path}" fill="none" stroke="#0b5e3b" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#0b5e3b" stroke-width="2"><title>${lab[i]}: ${d[i]}</title></circle><text x="${p[0]}" y="${p[1] - 11}" font-size="11" fill="#5b6b7f" text-anchor="middle">${d[i]}</text><text x="${p[0]}" y="${H - 5}" font-size="11.5" fill="#5b6b7f" text-anchor="middle">${lab[i]}</text>`).join('')}</svg>`;
}
function tierBars(counts, tiers) {
  const colors = { Gold: '#b7791f', Silver: '#64748b', Bronze: '#c2410c' };
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const sorted = [...tiers].sort((a, b) => b.annualDues - a.annualDues);
  return sorted.map(t => { const n = counts[t.name] || 0; return `<div class="mb-3"><div class="d-flex justify-content-between small mb-1"><span class="fw-medium">${esc(t.name)}</span><span class="text-body-secondary">${n} · ${Math.round(n / total * 100)}%</span></div>
    <div class="progress" style="height:8px"><div class="progress-bar" style="width:${n / total * 100}%;background:${colors[t.name] || '#0b5e3b'}"></div></div></div>`; }).join('')
    + `<div class="border-top pt-3 mt-4 small d-flex justify-content-between gap-2"><span class="text-body-secondary">Annual dues</span><span class="fw-medium text-end">${sorted.map(t => `${esc(t.name)} ${K(t.annualDues)}`).join(' · ')}</span></div>`;
}
function regionBars(regions) {
  const sorted = Object.entries(regions);
  if (!sorted.length) return empty('No members yet.');
  const rows = sorted.length > 7 ? [...sorted.slice(0, 6), ['Other provinces', sorted.slice(6).reduce((n, [, v]) => n + v, 0)]] : sorted, max = sorted[0][1];
  return rows.map(([k, n]) => `<div class="mb-2"><div class="d-flex justify-content-between small mb-1"><span class="fw-medium">${esc(k)}</span><span class="text-body-secondary">${n}</span></div>
    <div class="progress" style="height:6px"><div class="progress-bar" style="width:${n / max * 100}%;background:#0b5e3b"></div></div></div>`).join('');
}

/* ================= MEMBERS ================= */
const MTABS = [['all', 'All', {}], ['active', 'Active', { status: 'ACTIVE' }], ['lapsed', 'Lapsed', { status: 'LAPSED' }], ['suspended', 'Suspended', { status: 'SUSPENDED' }], ['dues', 'Dues due', { filter: 'dues_due' }], ['mof', 'MoF expired', { filter: 'mof_expired' }]];
let MS = { tab: 'all', q: '', page: 1 };
const setMTab = k => { MS = { ...MS, tab: k, page: 1 }; rerender(); };
const setMQuery = q => { MS = { ...MS, q, page: 1 }; rerender(); };
const setMPage = p => { MS.page = p; rerender(); };

async function members(number) {
  if (number) return memberDetail(number);
  const tab = MTABS.find(t => t[0] === MS.tab);
  const r = await adm(`/members${qs({ ...tab[2], q: MS.q, page: MS.page, pageSize: 25 })}`);
  return pageHeader('Members', 'Accredited lenders, their MoF authorization, accreditation and dues',
    `<button class="btn btn-outline-secondary" onclick="getFile('/admin/members/export.csv',this)">${icon('download', 'me-1')} Export CSV</button><a class="btn btn-primary" href="#/apply" target="_blank">${icon('plus-lg', 'me-1')} New application</a>`)
    + searchBox(MS.q, 'setMQuery', 'Search by name, member number, town or TPIN')
    + pills(MTABS.map(([k, l]) => [k, l]), MS.tab, 'setMTab')
    + tableCard(['Member', 'Member no.', 'Town', 'Tier', 'MoF', 'Accreditation', 'Dues', 'Status'], r.items.map((m, i) => `<tr class="clickable" onclick="nav('app/members/${esc(m.number)}')">
      <td><div class="d-flex align-items-center gap-2">${avatar(m.name, i)}<div><div class="fw-medium">${esc(m.name)}</div><div class="small text-body-secondary">${esc(m.contactName)}</div></div></div></td>
      <td class="small font-monospace">${esc(m.number)}</td><td>${esc(m.town)}</td><td>${tierBadge(esc(m.tier))}</td><td>${mofBadge(lower(m.mofStatus))}</td><td>${accredBadge(lower(m.accreditation))}</td>
      <td>${m.duesDue ? '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle">Due</span>' : '<span class="badge rounded-pill bg-success-subtle text-success-emphasis border border-success-subtle">Paid</span>'}</td><td>${statusBadge(lower(m.status))}</td></tr>`).join(''),
    MS.q ? 'No members match your search.' : 'No members match this filter.', pager(r, 'setMPage'));
}

const ACTIVITY = {
  dues_paid: ['credit-card', 'warning'], accreditation_issued: ['award', 'success'], suspended: ['slash-circle', 'danger'], reinstated: ['arrow-counterclockwise', 'success'],
  reminder_sent: ['envelope', 'info'], mof_renewal: ['file-earmark-check', 'info'], profile_updated: ['pencil', 'secondary'], event_registered: ['calendar-check', 'primary'], lapsed: ['hourglass-bottom', 'warning'],
};
let CUR_MEMBER = null;

async function memberDetail(number) {
  const m = CUR_MEMBER = await adm(`/members/${encodeURIComponent(number)}`);
  const n = esc(m.number), nArg = jsArg(m.number), d = m.dues;
  const renewal = m.pendingRenewal && m.renewals.find(r => r.id === m.pendingRenewal.id);
  const actions = [
    m.certificate ? `<button class="btn btn-outline-secondary" onclick="getFile('/admin/members/${n}/certificate.pdf',this)">${icon('award', 'me-1')} Certificate</button>` : '',
    can('members:write') ? `<button class="btn btn-outline-secondary" onclick="editMember()">${icon('pencil', 'me-1')} Edit</button><button class="btn btn-outline-secondary" onclick="sendReminder(${nArg},this)">${icon('envelope', 'me-1')} Send reminder</button>` : '',
    can('payments:record') && d.payable ? `<button class="btn btn-outline-secondary" onclick="recordDues(${nArg})">${icon('cash', 'me-1')} Record dues payment</button>` : '',
    can('members:write') ? (m.status === 'ACTIVE' ? `<button class="btn btn-outline-danger" onclick="suspendMember(${nArg})">${icon('slash-circle', 'me-1')} Suspend</button>` : `<button class="btn btn-primary" onclick="reinstateMember(${nArg})">${icon('arrow-counterclockwise', 'me-1')} Reinstate</button>`) : '',
  ].join('');
  const duesBadgeHtml = d.overdue ? '<span class="badge rounded-pill bg-danger-subtle text-danger-emphasis border border-danger-subtle">Overdue</span>'
    : d.payable ? '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle">Due</span>'
      : '<span class="badge rounded-pill bg-success-subtle text-success-emphasis border border-success-subtle">Paid</span>';
  return pageHeader(esc(m.name), `${n} · ${esc(m.town)}, ${esc(m.province)} · member since ${fmtDate(m.joinedAt)}`, actions, crumb('members', 'Members', m.name))
    + (m.status === 'SUSPENDED' ? note('danger', 'slash-circle', `<b>Suspended${m.suspension === 'MOF_EXPIRED' ? ' (MoF authorization expired)' : ' by the Secretariat'}.</b> ${esc(m.suspensionReason || '')}${m.suspension === 'MOF_EXPIRED' ? ' The suspension is lifted automatically when a renewed authorization is verified.' : ''}`) : '')
    + (m.status === 'LAPSED' ? note('warning', 'hourglass-bottom', `<b>Lapsed.</b> The paid period ended ${fmtDate(m.validUntil)}. Recording a dues payment restores the membership.`) : '')
    + `<div class="row g-3">
      <div class="col-lg-4"><div class="card"><div class="card-body p-4">
        <div class="text-center mb-3">${avatar(m.name, 0, true)}<h2 class="h5 mt-3 mb-1">${esc(m.name)}</h2><div class="d-flex justify-content-center gap-1">${tierBadge(esc(m.tier))} ${statusBadge(lower(m.status))}</div></div>
        ${info('Contact', esc(m.contactName))}${info('Phone', esc(m.contactPhone))}${info('Email', esc(m.contactEmail))}${info('ZRA TPIN', esc(m.tpin))}${info('PACRA no.', esc(m.pacra || '—'))}${info('Address', esc(m.address || '—'))}${info('Joined', fmtDate(m.joinedAt))}
        ${info('Public listing', m.goodStanding ? '<span class="text-success-emphasis">Listed, passes verification</span>' : '<span class="text-danger-emphasis">Hidden, fails verification</span>')}
      </div></div>
      <div class="card mt-3"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Portal users</h2>${can('members:write') ? `<button class="btn btn-sm btn-outline-primary" onclick="inviteUser(${nArg})">${icon('person-plus', 'me-1')} Invite</button>` : ''}</div>
        <div class="list-group list-group-flush">${m.users.map(u => listItem('person', u.active ? 'primary' : 'secondary', `${esc(u.name)}${u.active ? '' : ' <span class="badge bg-secondary-subtle text-secondary-emphasis">Deactivated</span>'}`,
          `${esc(u.email)}${u.invitePending ? ' · invitation not yet accepted' : u.lastLoginAt ? ` · last signed in ${fmtDateTime(u.lastLoginAt)}` : ''}`,
          can('members:write') ? `<button class="btn btn-sm ${u.active ? 'btn-outline-danger' : 'btn-outline-secondary'}" onclick="setPortalUser(${jsArg(m.number)},${jsArg(u.id)},${!u.active})">${u.active ? 'Deactivate' : 'Reactivate'}</button>` : '')).join('') || empty('No portal users yet.', 'person')}</div></div>
      </div>
      <div class="col-lg-8">
        <div class="row g-3 mb-3">
          <div class="col-md-4">${statCard('MoF authorization', mofBadge(lower(m.mofStatus)), `${esc(m.mofRef)}${m.mofExpiry ? ` · expires ${fmtDate(m.mofExpiry)}` : ''}`, 'file-earmark-check', 'info')}</div>
          <div class="col-md-4">${statCard('Accreditation', accredBadge(lower(m.accreditation)), `Valid until ${fmtDate(m.validUntil)}`, 'award', 'success')}</div>
          <div class="col-md-4">${statCard('Annual dues', duesBadgeHtml, `${esc(m.tier)} · ${K(d.amount)}${d.payable ? '' : ` · next payable from ${fmtDate(d.opensOn)}`}`, 'cash-stack', 'warning')}</div>
        </div>
        ${renewal ? `<div class="card mb-3 border-warning-subtle"><div class="card-header bg-warning-subtle"><h2 class="h6 mb-0 py-1">${icon('file-earmark-arrow-up', 'me-1')}MoF renewal awaiting verification</h2></div><div class="card-body">
          <p class="small mb-3">Renewed authorization <b>${esc(renewal.mofRef)}</b> uploaded ${fmtDateTime(renewal.submittedAt)}. Check it against the Ministry of Finance register, then record its expiry date.</p>
          <div class="d-flex flex-wrap gap-2">${renewal.document && can('documents:read') ? `<button class="btn btn-outline-secondary" onclick="viewDoc(${jsArg(renewal.document.id)},${jsArg(`MoF renewal · ${m.name}`)})">${icon('eye', 'me-1')} View document</button>` : ''}
          ${can('renewals:verify') ? `<button class="btn btn-outline-danger" onclick="rejectRenewal(${jsArg(renewal.id)})">Reject</button><button class="btn btn-primary" onclick="verifyRenewal(${jsArg(renewal.id)},${jsArg(renewal.mofRef)})">${icon('check-lg', 'me-1')} Verify renewal</button>` : ''}</div></div></div>` : ''}
        <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Documents</h2></div><div class="list-group list-group-flush">
          ${m.documents.map(doc => listItem(doc.kind === 'DIRECTOR_NRC' ? 'person-vcard' : doc.kind === 'PROOF_OF_PAYMENT' ? 'receipt' : 'file-earmark-text', doc.superseded ? 'secondary' : 'info', `${DOC_KIND[doc.kind] || esc(doc.kind)}${doc.superseded ? ' <span class="badge bg-secondary-subtle text-secondary-emphasis">Replaced</span>' : ''}`, `${esc(doc.filename)} · ${fmtDate(doc.createdAt)}`,
            can('documents:read') ? `<button class="btn btn-sm btn-outline-primary text-nowrap" onclick="viewDoc(${jsArg(doc.id)},${jsArg(`${DOC_KIND[doc.kind] || doc.kind} · ${m.name}`)})">${icon('eye', 'me-1')} View</button>` : '')).join('') || empty('No documents on file.', 'folder')}
        </div></div>
        <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Payments</h2></div>
          ${m.payments.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0 small"><thead><tr><th>Reference</th><th>Date</th><th>Description</th><th>Method</th><th class="text-end">Amount</th><th>Status</th><th></th></tr></thead><tbody>${m.payments.map(p => paymentRow(p, { payer: false })).join('')}</tbody></table></div>` : `<div class="card-body">${empty('No payments yet.', 'credit-card')}</div>`}</div>
        <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Activity</h2></div><div class="list-group list-group-flush">
          ${m.activity.map(a => { const [ic, tone] = ACTIVITY[a.kind] || ['dot', 'secondary']; return listItem(ic, tone, esc(a.title), `${esc(a.detail)}${a.detail ? ' · ' : ''}${fmtDateTime(a.at)}`); }).join('') || empty('No activity yet.', 'activity')}
        </div></div>
        ${auditCard(m.audit)}
      </div>
    </div>`;
}

function editMember() {
  const m = CUR_MEMBER;
  const f = (name, label, value, attrs = '', col = 'col-md-6') => `<div class="${col}"><label class="form-label small fw-medium">${label}</label><input class="form-control" name="${name}" value="${esc(value)}" ${attrs}><div class="invalid-feedback">Check this field.</div></div>`;
  publicConfig().then(cfg => asyncModal({
    title: `Edit ${esc(m.name)}`, size: 'lg', confirmText: 'Save changes',
    body: `<div class="row g-3">${f('name', 'Business name', m.name, 'required', 'col-12')}${f('town', 'Town', m.town, 'required')}
      <div class="col-md-6"><label class="form-label small fw-medium">Province</label><select class="form-select" name="province">${cfg.provinces.map(p => `<option ${p === m.province ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
      ${f('address', 'Address', m.address, '', 'col-12')}${f('tpin', 'ZRA TPIN', m.tpin, 'required pattern="[0-9]{10}" maxlength="10"')}${f('pacra', 'PACRA no.', m.pacra, 'pattern="[0-9]{12}" maxlength="12"')}
      <div class="col-md-6"><label class="form-label small fw-medium">Tier</label><select class="form-select" name="tier">${cfg.tiers.map(t => `<option ${t.name === m.tier ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      ${f('contactName', 'Contact person', m.contactName, 'required')}${f('contactPhone', 'Phone', m.contactPhone, 'required type="tel"')}${f('contactEmail', 'Email', m.contactEmail, 'required type="email"')}</div>`,
    onSubmit: async v => { await adm(`/members/${encodeURIComponent(m.number)}`, { method: 'PATCH', body: v }); done('Member details saved'); },
  })).catch(fail);
}
async function sendReminder(n, btn) {
  busy(btn, true, 'Sending…');
  try { await adm(`/members/${n}/reminders`, { method: 'POST' }); done('Reminder sent by email and SMS'); } catch (e) { busy(btn, false); fail(e); }
}
const offlineFields = (refLabel = 'Bank reference or receipt number') => `<div class="row g-3"><div class="col-6"><label class="form-label small fw-medium">Method</label><select class="form-select" name="method"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option></select></div>
  <div class="col-6"><label class="form-label small fw-medium">${refLabel}</label><input class="form-control" name="reference" required placeholder="e.g. FT26285ABC12"><div class="invalid-feedback">Required.</div></div></div>`;
function recordDues(n) {
  const d = CUR_MEMBER.dues;
  asyncModal({
    title: 'Record dues payment', confirmText: 'Record payment',
    body: `<p class="small text-body-secondary">Record ${K(d.amount)} received from ${esc(CUR_MEMBER.name)} outside the online checkout, for ${fmtDate(d.periodStart)} to ${fmtDate(d.periodEnd)}. Only record money you can see on the MLAZ bank statement or a cash receipt.</p>${offlineFields()}`,
    onSubmit: async v => { await adm(`/members/${n}/offline-dues`, { method: 'POST', body: v }); done('Payment recorded. Membership extended and receipt sent'); },
  });
}
function suspendMember(n) {
  asyncModal({
    title: 'Suspend member', confirmText: 'Suspend', tone: 'danger',
    body: `<p>Suspending <b>${esc(CUR_MEMBER.name)}</b> revokes their accreditation and removes them from the public directory. Only staff can reinstate them.</p><label class="form-label small fw-medium">Reason (sent to the member)</label><textarea class="form-control" name="reason" rows="2" required>Non-compliance with the MLAZ code of conduct</textarea><div class="invalid-feedback">Give a reason.</div>`,
    onSubmit: async v => { await adm(`/members/${n}/suspend`, { method: 'POST', body: { reason: v.reason } }); done(`${CUR_MEMBER.name} suspended`); },
  });
}
function reinstateMember(n) {
  asyncModal({
    title: 'Reinstate member', confirmText: 'Reinstate',
    body: `<p class="mb-0">Reinstate <b>${esc(CUR_MEMBER.name)}</b>? Their accreditation is restored and a new certificate issued. This needs a valid MoF authorization and a paid membership period.</p>`,
    onSubmit: async () => { await adm(`/members/${n}/reinstate`, { method: 'POST' }); done(`${CUR_MEMBER.name} reinstated`); },
  });
}
function verifyRenewal(id, mofRef) {
  asyncModal({
    title: 'Verify MoF renewal', confirmText: 'Verify',
    body: `<p class="small text-body-secondary">Confirm <b>${esc(mofRef)}</b> on the Ministry of Finance register and enter the expiry date shown on the authorization.</p>
      <label class="form-label small fw-medium">Authorization valid until</label><input class="form-control" type="date" name="mofExpiry" min="${tomorrow()}" required><div class="invalid-feedback">Enter a future date.</div>`,
    onSubmit: async v => { await adm(`/renewals/${id}/verify`, { method: 'POST', body: v }); done('MoF renewal verified'); },
  });
}
function rejectRenewal(id) {
  asyncModal({
    title: 'Reject MoF renewal', confirmText: 'Reject', tone: 'danger',
    body: `<label class="form-label small fw-medium">Reason (sent to the member)</label><textarea class="form-control" name="reason" rows="3" required>The authorization could not be found on the Ministry of Finance register. Please upload a valid authorization.</textarea><div class="invalid-feedback">Give a reason.</div>`,
    onSubmit: async v => { await adm(`/renewals/${id}/reject`, { method: 'POST', body: v }); done('Renewal rejected; the member has been told'); },
  });
}
function setPortalUser(number, userId, active) {
  asyncModal({
    title: active ? 'Reactivate portal user' : 'Deactivate portal user', confirmText: active ? 'Reactivate' : 'Deactivate', tone: active ? 'primary' : 'danger',
    body: `<p class="mb-0">${active ? 'This person will be able to sign in to the member portal again.' : 'This person is signed out at once and can no longer sign in to the member portal. Use this when someone leaves the business.'}</p>`,
    onSubmit: async () => { await adm(`/members/${encodeURIComponent(number)}/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { active } }); done(active ? 'Portal user reactivated' : 'Portal user deactivated and signed out'); },
  });
}
function inviteUser(n) {
  asyncModal({
    title: 'Invite a portal user', confirmText: 'Send invitation',
    body: `<p class="small text-body-secondary">They’ll get an email to set a password for ${esc(CUR_MEMBER.name)}’s member portal.</p>
      <div class="mb-3"><label class="form-label small fw-medium">Full name</label><input class="form-control" name="name" required><div class="invalid-feedback">Required.</div></div>
      <label class="form-label small fw-medium">Email</label><input class="form-control" type="email" name="email" required><div class="invalid-feedback">Enter a valid email.</div>`,
    onSubmit: async v => { await adm(`/members/${n}/users`, { method: 'POST', body: v }); done(`Invitation sent to ${v.email}`); },
  });
}

/* ================= APPLICATIONS ================= */
const JOURNEY = ['Submitted', 'MoF authorization', 'Verification', 'Payment', 'Accredited'];
const STAGE_IDX = { DETAILS: 1, MOF_REVIEW: 2, PAYMENT_PENDING: 3, ACCREDITED: 5 };
const ASTAGES = [['OPEN', 'Open'], ['MOF_REVIEW', 'MoF review'], ['AWAITING_APPROVAL', 'Awaiting approval'], ['PAYMENT_PENDING', 'Awaiting payment'], ['DETAILS', 'Awaiting documents'], ['ACCREDITED', 'Accredited'], ['REJECTED', 'Not approved'], ['ALL', 'All']];
let AS = { stage: 'OPEN', q: '', page: 1 };
const setAStage = k => { AS = { ...AS, stage: k, page: 1 }; rerender(); };
const setAQuery = q => { AS = { ...AS, q, page: 1 }; rerender(); };
const setAPage = p => { AS.page = p; rerender(); };

async function applications(ref) {
  if (ref) return appDetail(ref);
  const r = await adm(`/applications${qs({ stage: AS.stage === 'ALL' ? '' : AS.stage, q: AS.q, page: AS.page, pageSize: 25 })}`);
  return pageHeader('Applications', 'Self-onboarded lenders progressing to accredited membership', `<a class="btn btn-primary" href="#/apply" target="_blank">${icon('plus-lg', 'me-1')} New application</a>`)
    + note('light border', 'info-circle', 'The Ministry of Finance authorization is verified <b>first</b>: one officer recommends and a second approves. Only then can the applicant pay, and accreditation is issued automatically on payment.')
    + searchBox(AS.q, 'setAQuery', 'Search by business name, reference or town')
    + pills(ASTAGES, AS.stage, 'setAStage')
    + tableCard(['Reference', 'Applicant', 'Town', 'Tier', 'MoF reference', 'Stage', 'Submitted'], r.items.map(a => `<tr class="clickable" onclick="nav('app/applications/${esc(a.ref)}')">
      <td class="small font-monospace">${esc(a.ref)}</td><td><div class="fw-medium">${esc(a.businessName)}</div>${a.recommendedBy ? `<div class="small text-body-secondary">Recommended by ${esc(a.recommendedBy)}</div>` : ''}</td><td>${esc(a.town)}</td><td>${tierBadge(esc(a.tier))}</td>
      <td class="small">${esc(a.mofRef || '—')}</td><td>${appBadge(a)}</td><td class="small text-body-secondary">${fmtDate(a.submittedAt)}</td></tr>`).join(''), 'No applications here.', pager(r, 'setAPage'));
}

let CUR_APP = null;
function checksCard(a) {
  const c = a.checks;
  const row = (ok, title, sub, bad = 'warning') => listItem(ok ? 'check-circle-fill' : 'exclamation-triangle-fill', ok ? 'success' : bad, title, sub);
  return `<div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Automated checks</h2></div><div class="list-group list-group-flush">
    ${row(c.tpinValid, c.tpinValid ? 'TPIN format valid' : 'TPIN is not valid', `${esc(a.business.tpin)} · ZRA register lookup is not connected yet; confirm manually`, 'danger')}
    ${row(!c.duplicates.length, c.duplicates.length ? 'Possible duplicate' : 'No duplicates found', c.duplicates.length
      ? c.duplicates.map(d => `Same ${esc(d.matches.join(', '))} as <a href="#/app/${d.type === 'member' ? 'members' : 'applications'}/${esc(d.ref)}">${esc(d.name)}</a> (${d.type} ${esc(d.ref)}, ${esc(lower(d.status).replace('_', ' '))})`).join('<br>')
      : 'Checked against all members and open applications by TPIN, PACRA no., name, email and phone', 'danger')}
    ${row(!c.missingDocuments.length, c.missingDocuments.length ? 'Documents incomplete' : 'All documents received', c.missingDocuments.length ? `Missing: ${c.missingDocuments.map(k => DOC_KIND[k]).join(', ')}` : 'MoF authorization, PACRA certificate and director NRC')}
  </div></div>`;
}
function docsCard(a) {
  const detail = { MOF_AUTHORIZATION: `Ref ${esc(a.mofRef || '—')}${a.mofExpiry ? ` · expires ${fmtDate(a.mofExpiry)}` : ''}`, PACRA_CERTIFICATE: `PACRA ${esc(a.business.pacra)}`, DIRECTOR_NRC: `${esc(a.director.name)} · NRC ${esc(a.director.nrc)}` };
  const docs = [...a.documents].sort((x, y) => x.superseded - y.superseded);
  return `<div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Documents</h2></div><div class="list-group list-group-flush">
    ${docs.map(d => listItem(d.kind === 'DIRECTOR_NRC' ? 'person-vcard' : d.kind === 'PROOF_OF_PAYMENT' ? 'receipt' : 'file-earmark-text', d.superseded ? 'secondary' : 'info',
      `${DOC_KIND[d.kind]}${d.superseded ? ' <span class="badge bg-secondary-subtle text-secondary-emphasis">Replaced</span>' : ''}`, `${esc(d.filename)}${detail[d.kind] && !d.superseded ? ` · ${detail[d.kind]}` : ''} · ${fmtDate(d.uploadedAt)}`,
      can('documents:read') ? `<button class="btn btn-sm btn-outline-primary text-nowrap" onclick="viewDoc(${jsArg(d.id)},${jsArg(`${DOC_KIND[d.kind]} · ${a.business.name}`)})">${icon('eye', 'me-1')} View</button>` : '')).join('') || empty('No documents uploaded.', 'folder')}
  </div></div>`;
}
function decision(a) {
  const rec = a.recommendation, ref = esc(a.ref), refArg = jsArg(a.ref), myId = getSession()?.userId;
  const reject = can('applications:approve') ? `<button class="btn btn-outline-danger" onclick="rejectApp(${refArg})">Reject application</button>` : '';
  if (a.stage === 'DETAILS') return (a.returnNote ? note('danger', 'arrow-return-left', `Returned to applicant: ${esc(a.returnNote)}`) : '')
    + note('warning', 'hourglass', `The applicant has not yet uploaded their MoF authorization. They can do so from the tracking link in their confirmation email (reference <b>${ref}</b>).`)
    + `<div class="d-flex flex-wrap gap-2">${reject}</div>`;
  if (a.stage === 'MOF_REVIEW' && !rec) {
    if (!can('applications:recommend')) return note('info', 'hourglass-split', 'Awaiting review and a recommendation from a Membership Officer.') + `<div class="d-flex flex-wrap gap-2">${reject}</div>`;
    return note('info', 'search', '<b>Step 1 of 2 (maker).</b> Check the documents and the Ministry of Finance register, then recommend approval. A second officer must approve.')
      + `<div class="d-flex flex-wrap gap-2">${reject}${can('applications:return') ? `<button class="btn btn-outline-danger" onclick="returnApp(${refArg})">Return to applicant</button>` : ''}<button class="btn btn-primary" onclick="recommendApp(${refArg})">${icon('person-check', 'me-1')} Recommend approval</button></div>`;
  }
  if (a.stage === 'MOF_REVIEW') {
    const by = note('light border', 'person-check', `Recommended by <b>${esc(rec.by)}</b>${rec.title ? ` (${esc(rec.title)})` : ''} · ${fmtDateTime(rec.at)}${rec.note ? `<div class="mt-1 fst-italic">“${esc(rec.note)}”</div>` : ''}${a.mofExpiry ? `<div class="mt-1">MoF authorization valid until ${fmtDate(a.mofExpiry)}</div>` : ''}`);
    if (rec.userId === myId) return by + note('warning', 'shield-lock', '<b>Maker-checker:</b> you made this recommendation, so a different officer (the Secretariat Admin) must approve it.');
    if (!can('applications:approve')) return by + note('info', 'hourglass-split', 'Awaiting approval by the Secretariat Admin.');
    return by + note('info', 'clipboard-check', '<b>Step 2 of 2 (checker).</b> Review the recommendation, the documents and the automated checks, then approve or decline.')
      + `<div class="d-flex flex-wrap gap-2">${reject}<button class="btn btn-outline-danger" onclick="declineRec(${refArg})">Decline recommendation</button><button class="btn btn-primary" onclick="approveApp(${refArg})">${icon('check-lg', 'me-1')} Approve</button></div>`;
  }
  if (a.stage === 'PAYMENT_PENDING') {
    const pending = a.payments.find(p => p.status === 'PENDING');
    if (pending?.method === 'BANK_TRANSFER' && pending.hasProof) return note('info', 'bank', `The applicant paid ${K(pending.amount)} by bank transfer (ref ${esc(pending.bankRef)}) and uploaded proof of payment. Confirming it issues the accreditation certificate automatically.`)
      + (can('payments:confirm') ? `<button class="btn btn-primary" onclick="reviewPayment(${jsArg(pending.ref)})">${icon('file-earmark-check', 'me-1')} Review proof of payment</button>` : note('light border', 'info-circle', 'MLAZ Finance will confirm the transfer.'));
    return note('warning', 'credit-card', `Approved. Awaiting ${K(a.fees.total)} from the applicant (joining fee ${K(a.fees.joiningFee)} + ${esc(a.business.tier)} dues ${K(a.fees.annualDues)}). The accreditation certificate is issued automatically as soon as payment is received.${pending ? `<div class="mt-1">Payment ${esc(pending.ref)} by ${esc(pending.methodLabel)} is in progress.</div>` : ''}`)
      + `<div class="d-flex flex-wrap gap-2">${reject}${can('payments:record') ? `<button class="btn btn-outline-primary" onclick="recordAppPayment(${refArg})">Record offline payment</button>` : ''}</div>`;
  }
  if (a.stage === 'REJECTED') return note('danger', 'x-octagon', `<b>Not approved.</b> ${esc(a.rejectionReason || '')}`);
  return note('success', 'award', `Accredited as member <b>${esc(a.memberNumber)}</b>. The certificate was generated automatically on payment.`)
    + `<div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-secondary" onclick="getFile('/admin/members/${esc(a.memberNumber)}/certificate.pdf',this)">${icon('award', 'me-1')} Certificate</button><a class="btn btn-primary" href="#/app/members/${esc(a.memberNumber)}">Open member record</a></div>`;
}
async function appDetail(ref) {
  const a = CUR_APP = await adm(`/applications/${encodeURIComponent(ref)}`);
  return pageHeader(esc(a.business.name), `${esc(a.ref)} · ${esc(a.business.town)} · submitted ${fmtDateTime(a.submittedAt)}`, appBadge(a), crumb('applications', 'Applications', a.business.name))
    + (STAGE_IDX[a.stage] ? `<div class="card mb-3"><div class="card-body py-4">${stepper(JOURNEY, STAGE_IDX[a.stage])}</div></div>` : '')
    + `<div class="row g-3">
      <div class="col-lg-7">
        <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Review and decision</h2></div><div class="card-body">${decision(a)}</div></div>
        ${docsCard(a)}
        ${a.payments.length ? `<div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Payments</h2></div><div class="table-responsive"><table class="table table-sm align-middle mb-0 small"><thead><tr><th>Reference</th><th>Date</th><th>Description</th><th>Method</th><th class="text-end">Amount</th><th>Status</th><th></th></tr></thead><tbody>${a.payments.map(p => paymentRow(p, { payer: false })).join('')}</tbody></table></div></div>` : ''}
      </div>
      <div class="col-lg-5">
        ${checksCard(a)}
        <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Applicant details</h2></div><div class="card-body">
          ${info('Business name', esc(a.business.name))}${info('PACRA no.', esc(a.business.pacra))}${info('ZRA TPIN', esc(a.business.tpin))}${info('Location', esc([a.business.town, a.business.province].join(', ')))}${info('Address', esc(a.business.address || '—'))}
          ${info('Contact', esc(`${a.contact.name}, ${a.contact.position}`))}${info('Director', esc(`${a.director.name} · ${a.director.nrc}`))}${info('Phone', esc(a.contact.phone))}${info('Email', esc(a.contact.email))}${info('Tier', tierBadge(esc(a.business.tier)))}${info('Fees on approval', K(a.fees.total))}
        </div></div>
      </div>
    </div>
    ${auditCard(a.audit)}`;
}
const appAction = (path, body) => adm(`/applications/${encodeURIComponent(CUR_APP.ref)}/${path}`, { method: 'POST', body });
function recommendApp() {
  const flags = CUR_APP.checks.flags;
  asyncModal({
    title: 'Recommend for approval', confirmText: 'Send for approval',
    body: `${flags.length ? note('warning', 'exclamation-triangle', `Automated checks flagged: <b>${esc(flags.join(', '))}</b>. Explain in your note why you still recommend approval.`) : ''}
      <p class="small text-body-secondary">A second officer must approve before the applicant is asked to pay.</p>
      <div class="mb-3"><label class="form-label small fw-medium">MoF authorization valid until</label><input class="form-control" type="date" name="mofExpiry" min="${tomorrow()}" required><div class="invalid-feedback">Enter the future expiry date shown on the authorization.</div></div>
      <label class="form-label small fw-medium">Note for the approver</label><textarea class="form-control" name="note" rows="3" ${flags.length ? 'required minlength="10"' : ''}>${flags.length ? '' : 'Authorization confirmed on the Ministry of Finance register.'}</textarea><div class="invalid-feedback">At least 10 characters explaining the flagged checks.</div>`,
    onSubmit: async v => { await appAction('recommend', v); done('Sent to a second officer for approval'); },
  });
}
function approveApp() {
  asyncModal({
    title: 'Approve application', confirmText: 'Approve',
    body: `<p class="mb-0">Approve the MoF authorization for <b>${esc(CUR_APP.business.name)}</b>, recommended by ${esc(CUR_APP.recommendation.by)}? The applicant will be sent a payment link for ${K(CUR_APP.fees.total)}.</p>`,
    onSubmit: async () => { await appAction('approve'); done('Approved. Payment link sent to the applicant'); },
  });
}
const reasonModal = (title, confirmText, prefill, path, msg, help = 'The application goes back to the maker for another review.') => asyncModal({
  title, confirmText, tone: 'danger',
  body: `<p class="small text-body-secondary">${help}</p><label class="form-label small fw-medium">Reason</label><textarea class="form-control" name="reason" rows="3" required>${esc(prefill)}</textarea><div class="invalid-feedback">Give a reason.</div>`,
  onSubmit: async v => { await appAction(path, { reason: v.reason }); done(msg); },
});
const declineRec = () => reasonModal('Decline recommendation', 'Decline', '', 'decline-recommendation', 'Recommendation declined; the officer has been told');
const returnApp = () => reasonModal('Return to applicant', 'Return application', 'Authorization reference not found on the Ministry of Finance register. Please upload a valid authorization.', 'return', 'Application returned to the applicant', 'The reason is emailed to the applicant, who can upload a new authorization.');
const rejectApp = () => reasonModal('Reject application', 'Reject', '', 'reject', 'Application rejected; the applicant has been told', 'This closes the application. The reason is emailed to the applicant.');
function recordAppPayment() {
  asyncModal({
    title: 'Record offline payment', confirmText: 'Record payment',
    body: `<p class="small text-body-secondary">Record ${K(CUR_APP.fees.total)} received from ${esc(CUR_APP.business.name)} outside the online checkout. The accreditation certificate is issued automatically.</p>${offlineFields('Reference')}`,
    onSubmit: async v => {
      const r = await appAction('offline-payment', v);
      toast(`Payment recorded. Accredited as ${r.memberNumber}`);
      nav(`app/members/${r.memberNumber}`);
    },
  });
}

/* ================= CERTIFICATES ================= */
async function certificates() {
  const apps = can('applications:read');
  const none = { items: [], total: 0 };
  const [review, approval, awaiting, renewals, certs] = await Promise.all([
    apps ? adm('/applications?stage=MOF_REVIEW&pageSize=100') : none, apps ? adm('/applications?stage=AWAITING_APPROVAL&pageSize=100') : none,
    apps ? adm('/applications?stage=PAYMENT_PENDING&pageSize=100') : none, adm('/renewals'), adm('/certificates'),
  ]);
  const soon = Date.now() + 90 * 864e5, valid = certs.filter(c => c.member.goodStanding);
  const mofList = [...review.items, ...approval.items];
  return pageHeader('Certificates', 'Verify Ministry of Finance authorizations, then issue MLAZ accreditation')
    + `<div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('MoF to verify', review.total + renewals.length, `new & renewals · ${approval.total} awaiting approval`, 'file-earmark-check', 'warning')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Awaiting payment', awaiting.total, 'certificate issues on payment', 'credit-card', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Accreditations valid', valid.length, 'members in good standing', 'patch-check', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Expiring in 90 days', valid.filter(c => new Date(c.validUntil) <= soon).length, 'reminders sent automatically', 'calendar-x', 'danger')}</div>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">1</span>MoF authorizations to verify</h2></div><div class="list-group list-group-flush">
        ${mofList.map(a => listItem('file-earmark-text', 'warning', esc(a.businessName), `${esc(a.mofRef || '—')} · ${a.displayStage === 'AWAITING_APPROVAL' ? `recommended by ${esc(a.recommendedBy)}, awaiting approval` : 'new application'}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${esc(a.ref)}">Review</a>`)).join('')}
        ${renewals.map(r => listItem('file-earmark-text', 'info', esc(r.member.name), `${esc(r.mofRef)} · renewal uploaded ${fmtDate(r.submittedAt)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/members/${esc(r.member.number)}">Review</a>`)).join('')}
        ${mofList.length + renewals.length ? '' : empty('Nothing waiting for verification.', 'check2-circle')}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">2</span>Awaiting payment</h2></div><div class="list-group list-group-flush">
        <div class="list-group-item small text-body-secondary">${icon('lightning-charge', 'me-1 text-primary')}Certificates are issued automatically the moment payment is received.</div>
        ${awaiting.items.map(a => listItem('credit-card', 'success', esc(a.businessName), `MoF approved · ${esc(a.tier)} tier`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${esc(a.ref)}">View</a>`)).join('') || empty('No applications awaiting payment.', 'check2-circle')}
      </div></div></div>
    </div>
    <h2 class="h6 mb-3">Issued accreditations</h2>`
    + tableCard(['Member', 'Certificate no.', 'Issued', 'Valid until', 'Status', '#'], certs.map(c => `<tr><td><a class="fw-medium" href="#/app/members/${esc(c.member.number)}">${esc(c.member.name)}</a><div class="small text-body-secondary">${esc(c.member.number)}</div></td>
      <td class="small font-monospace">${esc(c.serial)}</td><td class="small">${fmtDate(c.issuedAt)}</td><td class="small">${fmtDate(c.validUntil)}</td>
      <td>${c.member.goodStanding ? accredBadge('issued') : accredBadge(lower(c.member.accreditation))}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-secondary" title="Download certificate" onclick="getFile('/admin/members/${esc(c.member.number)}/certificate.pdf',this)">${icon('download')}</button></td></tr>`).join(''), 'No certificates issued yet.');
}

/* ================= PAYMENTS & EXPENSES ================= */
const PTABS = [['', 'All'], ['review', 'Awaiting review'], ['PENDING', 'Pending'], ['SUCCESS', 'Successful'], ['FAILED', 'Failed']];
let PS = { tab: '', q: '', page: 1 };
const setPTab = k => { PS = { ...PS, tab: k, page: 1 }; rerender(); };
const setPQuery = q => { PS = { ...PS, q, page: 1 }; rerender(); };
const setPPage = p => { PS.page = p; rerender(); };
let EXPENSES = [];

async function payments() {
  const canExp = can('expenses:read');
  const [s, list, exp] = await Promise.all([
    adm('/payments/summary'),
    adm(`/payments${qs({ status: PS.tab === 'review' ? '' : PS.tab, awaitingReview: PS.tab === 'review' ? 'true' : '', q: PS.q, page: PS.page, pageSize: 20 })}`),
    canExp ? adm('/expenses') : null,
  ]);
  EXPENSES = exp?.items || [];
  const feeCard = `<div class="card ${canExp ? 'mt-3' : ''}"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Fee schedule</h2></div><div class="card-body small">
      ${s.feeSchedule.tiers.map(t => `<div class="d-flex justify-content-between py-2 border-bottom"><span>${esc(t.name)} <span class="text-body-secondary">(${t.members} member${t.members === 1 ? '' : 's'})</span></span><b>${K(t.annualDues)} / yr</b></div>`).join('')}
      <div class="d-flex justify-content-between py-2"><span>Joining fee</span><b>${K(s.feeSchedule.joiningFee)} once</b></div>
      <div class="alert alert-light border mt-3 mb-0">${icon('phone', 'me-1 text-primary')} Members pay by MTN, Airtel or Zamtel mobile money, iZyane Pay QR, card or bank transfer. Receipts are issued automatically.</div>
    </div></div>`;
  const expensesCard = canExp ? `<div class="card"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Expenses</h2>${can('expenses:write') ? `<button class="btn btn-sm btn-primary" onclick="addExpense()">${icon('plus-lg', 'me-1')} Add expense</button>` : ''}</div>
      <div class="table-responsive" style="max-height:520px"><table class="table table-sm table-hover align-middle small mb-0"><thead class="sticky-top"><tr><th>Expense</th><th class="text-end">Amount</th><th></th></tr></thead><tbody>
      ${EXPENSES.map(x => `<tr><td><div class="fw-medium">${esc(x.description)}</div><div class="text-body-secondary">${esc(x.category)} · ${esc(x.payee)} · ${fmtDate(x.date)}</div>${x.event ? `<div class="text-body-secondary">${icon('calendar-event', 'me-1')}${esc(x.event.name)}</div>` : ''}</td>
        <td class="text-end fw-medium text-nowrap">${K(x.amount)}</td><td class="text-end"><button class="btn btn-sm btn-light" title="Details" onclick="viewExpense(${jsArg(x.ref)})">${icon('three-dots')}</button></td></tr>`).join('') || `<tr><td colspan="3">${empty('No expenses recorded.', 'wallet2')}</td></tr>`}
      </tbody>${EXPENSES.length ? `<tfoot><tr class="fw-semibold"><td>Total</td><td class="text-end text-nowrap">${K(exp.total)}</td><td></td></tr></tfoot>` : ''}</table></div></div>` : '';
  return pageHeader('Payments & dues', 'Joining fees, annual dues and event tickets across mobile money, card and bank',
    `${can('payments:confirm') ? `<button class="btn btn-outline-secondary" onclick="reconcile(this)">${icon('arrow-repeat', 'me-1')} Reconcile</button>` : ''}${can('comms:write') ? `<button class="btn btn-primary" onclick="broadcast('DUES_DUE')">${icon('envelope', 'me-1')} Send dues reminders</button>` : ''}`)
    + `<div class="row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xxl-5 g-3 mb-4">
      <div class="col">${statCard('Collected (YTD)', KM(s.collectedYtd), 'successful payments this year', 'cash-stack', 'primary')}</div>
      <div class="col">${statCard('Collected today', K(s.collectedToday), `${s.transactionsToday} transaction${s.transactionsToday === 1 ? '' : 's'}`, 'graph-up-arrow', 'success')}</div>
      <div class="col">${statCard('Dues due', s.duesDue, 'members', 'hourglass-split', 'warning')}</div>
      <div class="col">${statCard('Via mobile money', `${s.mobileMoneyShare}%`, 'of payments this year', 'phone', 'info')}</div>
      ${canExp ? `<div class="col">${statCard('Expenses (YTD)', KM(s.expensesYtd), `${s.expensesCount} recorded · ${K(s.expensesThisMonth)} this month`, 'wallet2', 'danger')}</div>` : ''}
    </div>
    <div class="row g-3"><div class="col-xl-8">`
    + searchBox(PS.q, 'setPQuery', 'Search by reference, payer or bank reference') + pills(PTABS, PS.tab, 'setPTab')
    + tableCard(['Reference', 'Payer', 'Description', 'Method', '#Amount', 'Status', '#'], list.items.map(p => paymentRow(p)).join(''), 'No payments here.', pager(list, 'setPPage'))
    + `</div><div class="col-xl-4">${expensesCard}${feeCard}</div></div>`;
}

async function reconcile(btn) {
  busy(btn, true, 'Checking…');
  try { const r = await adm('/payments/reconcile', { method: 'POST' }); done(r.checked ? `Checked ${r.checked} pending online payment(s) with the gateway · ${r.settled} settled` : 'No pending online payments to check'); }
  catch (e) { busy(btn, false); fail(e); }
}

// Bank transfers arrive with a proof of payment; Finance checks it against the bank statement before confirming.
async function reviewPayment(ref) {
  let p;
  try { p = await adm(`/payments/${encodeURIComponent(ref)}`); } catch (e) { return fail(e); }
  let url = null, doc = `<div class="border rounded p-4 text-center text-body-secondary small">${icon('file-earmark', 'fs-2 d-block mb-2')}No proof of payment uploaded</div>`;
  if (p.proofDocumentId && can('documents:read')) {
    try {
      const blob = await (await api(`/admin/documents/${p.proofDocumentId}`, { raw: true })).blob();
      url = URL.createObjectURL(blob);
      doc = blob.type.startsWith('image/') ? `<img src="${url}" alt="Proof of payment" class="img-fluid d-block mx-auto border rounded">` : `<iframe src="${url}" title="Proof of payment" class="w-100 border rounded" style="height:60vh"></iframe>`;
    } catch (e) { doc = note('danger', 'exclamation-circle', esc(e.message)); }
  }
  const row = (k, v) => `<div class="d-flex justify-content-between gap-2 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
  const reviewable = p.status === 'PENDING' && p.method === 'BANK_TRANSFER' && can('payments:confirm');
  const el = modal({
    title: `Proof of payment · ${esc(p.payerName)}`, size: 'xl',
    body: `<div class="row g-3"><div class="col-lg-8">${doc}</div><div class="col-lg-4">
      ${row('Payer', esc(p.payerName))}${p.lines.map(l => row(esc(l.description), K(l.amount))).join('')}${row('Total', `<b>${K(p.amount)}</b>`)}${row('Payment reference', `<span class="font-monospace">${esc(p.ref)}</span>`)}${row('Bank reference', esc(p.bankRef || '—'))}${row('Submitted', fmtDateTime(p.createdAt))}${row('Status', payBadge(lower(p.status)))}
      ${p.reviewedBy ? row('Reviewed by', `${esc(p.reviewedBy)}<div class="small text-body-secondary">${fmtDateTime(p.reviewedAt)}</div>`) : ''}
      ${reviewable ? note('light border', 'info-circle', 'Check the amount and both references against the MLAZ bank statement before confirming.', 'mt-3 mb-0') : ''}</div></div>`,
    footer: `${url ? `<a class="btn btn-light me-auto" href="${url}" download="proof-${esc(p.ref)}">${icon('download', 'me-1')} Download</a>` : ''}<button class="btn btn-light" data-bs-dismiss="modal">Close</button>
      ${reviewable ? `<button class="btn btn-outline-danger" data-reject>Reject</button><button class="btn btn-primary" data-confirm>${icon('check-lg', 'me-1')} Confirm payment</button>` : ''}`,
  });
  if (url) el.addEventListener('hidden.bs.modal', () => URL.revokeObjectURL(url));
  el.querySelector('[data-confirm]')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    busy(btn, true, 'Confirming…');
    try {
      await adm(`/payments/${encodeURIComponent(p.ref)}/confirm`, { method: 'POST' });
      el.close(); done(p.purpose === 'APPLICATION' ? 'Payment confirmed. Accreditation issued automatically' : p.purpose === 'EVENT' ? 'Payment confirmed. Registration confirmed' : 'Payment confirmed. Membership extended and receipt sent');
    } catch (err) { busy(btn, false); fail(err); }
  });
  el.querySelector('[data-reject]')?.addEventListener('click', () => { el.close(); setTimeout(() => asyncModal({
    title: 'Reject proof of payment', confirmText: 'Reject', tone: 'danger',
    body: `<label class="form-label small fw-medium">Reason (sent to the payer)</label><textarea class="form-control" name="reason" rows="3" required>The transfer could not be found on the MLAZ bank statement. Please check the reference and try again.</textarea><div class="invalid-feedback">Give a reason.</div>`,
    onSubmit: async v => { await adm(`/payments/${encodeURIComponent(p.ref)}/reject`, { method: 'POST', body: v }); done('Proof of payment rejected; the payer has been told'); },
  }), 350); });
}

async function addExpense() {
  let meta, evs;
  try { [meta, evs] = await Promise.all([adm('/expenses/categories'), can('events:read') ? adm('/events?past=true') : []]); } catch (e) { return fail(e); }
  const opts = list => list.map(o => `<option>${esc(o)}</option>`).join('');
  asyncModal({
    title: 'Add expense', confirmText: 'Add expense',
    body: `<div class="row g-3">
      <div class="col-md-6"><label class="form-label small fw-medium">Category</label><select class="form-select" name="category">${opts(meta.categories)}</select></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Date paid</label><input class="form-control" type="date" name="date" value="${today()}" max="${today()}" required></div>
      <div class="col-12"><label class="form-label small fw-medium">Description</label><input class="form-control" name="description" required placeholder="e.g. Conference room hire, 1 day"><div class="invalid-feedback">Required.</div></div>
      <div class="col-12"><label class="form-label small fw-medium">Paid to</label><input class="form-control" name="payee" required placeholder="Supplier or person"><div class="invalid-feedback">Required.</div></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Amount (K)</label><input class="form-control" type="number" name="amount" min="0.01" step="0.01" required><div class="invalid-feedback">Enter an amount above zero.</div></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Payment method</label><select class="form-select" name="method">${opts(meta.methods)}</select></div>
      <div class="col-12"><label class="form-label small fw-medium">Event <span class="text-body-secondary fw-normal">(optional)</span></label><select class="form-select" name="eventId"><option value="">Not linked to an event</option>${evs.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></div>
    </div>`,
    onSubmit: async v => { await adm('/expenses', { method: 'POST', body: { ...v, amount: Number(v.amount), eventId: v.eventId || null } }); done('Expense added'); },
  });
}
function viewExpense(ref) {
  const x = EXPENSES.find(e => e.ref === ref); if (!x) return;
  const row = (k, v) => `<div class="d-flex justify-content-between gap-3 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
  const el = modal({
    title: esc(x.description),
    body: `${row('Reference', `<span class="font-monospace">${esc(x.ref)}</span>`)}${row('Category', esc(x.category))}${row('Paid to', esc(x.payee))}${row('Amount', K(x.amount))}${row('Date paid', fmtDate(x.date))}${row('Method', esc(x.method))}${row('Event', x.event ? esc(x.event.name) : '—')}${row('Recorded by', esc(x.recordedBy))}`,
    footer: `${can('expenses:write') ? '<button class="btn btn-outline-danger me-auto" data-delete>Delete</button>' : ''}<button class="btn btn-light" data-bs-dismiss="modal">Close</button>`,
  });
  el.querySelector('[data-delete]')?.addEventListener('click', () => { el.close(); setTimeout(() => asyncModal({
    title: 'Delete expense', confirmText: 'Delete', tone: 'danger',
    body: `<p class="mb-0">Delete <b>${esc(x.description)}</b> (${K(x.amount)})? It stops counting in totals and the deletion is recorded in the audit trail.</p>`,
    onSubmit: async () => { await adm(`/expenses/${encodeURIComponent(x.ref)}`, { method: 'DELETE' }); done('Expense deleted'); },
  }), 300); });
}

/* ================= COMMUNICATIONS ================= */
let ANNOUNCEMENTS = [];
async function communications() {
  const [ann, bcs, res] = await Promise.all([adm('/announcements'), adm('/broadcasts'), adm('/resources')]);
  ANNOUNCEMENTS = ann;
  const write = can('comms:write');
  const groups = res.reduce((g, r) => ((g[r.category] ||= []).push(r), g), {});
  return pageHeader('Communications', 'Announcements, email and SMS broadcasts, and the member resource library',
    write ? `<button class="btn btn-outline-secondary" onclick="newAnnouncement()">${icon('plus-lg', 'me-1')} Announcement</button><button class="btn btn-primary" onclick="broadcast()">${icon('megaphone', 'me-1')} New broadcast</button>` : '')
    + `<div class="row g-3"><div class="col-lg-8">
      <div class="card mb-3"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Announcements</h2><span class="ms-auto small text-body-secondary">Shown on the website and member portal</span></div><div class="list-group list-group-flush">
        ${ann.map(a => listItem('megaphone', 'primary', esc(a.title), `${fmtDate(a.publishedAt)} · ${esc(a.body)}`, `<span class="badge bg-secondary-subtle text-secondary-emphasis">${esc(a.tag)}</span>${write ? `<button class="btn btn-sm btn-light" title="Remove" onclick="removeAnnouncement(${jsArg(a.id)})">${icon('trash')}</button>` : ''}`)).join('') || empty('No announcements.', 'megaphone')}
      </div></div>
      <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Sent broadcasts</h2></div><div class="list-group list-group-flush">
        ${bcs.map(b => listItem('send', 'info', esc(b.subject), `${fmtDateTime(b.createdAt)} · ${esc(b.audience)} · ${esc(b.channels.join(', '))} · ${b.recipientCount} recipient${b.recipientCount === 1 ? '' : 's'} · by ${esc(b.createdBy)}`,
          `<span class="small text-nowrap">${b.delivery.sent} sent${b.delivery.pending ? ` · ${b.delivery.pending} queued` : ''}${b.delivery.failed ? ` · <span class="text-danger-emphasis">${b.delivery.failed} failed</span>` : ''}</span>`)).join('') || empty('No broadcasts sent yet.', 'send')}
      </div></div>
    </div><div class="col-lg-4">
      <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Channels</h2></div><div class="list-group list-group-flush">
        ${listItem('envelope', 'info', 'Email', 'Member contact emails')}${listItem('chat-dots', 'warning', 'SMS', 'Sender ID: MLAZ')}${listItem('window', 'primary', 'Portal & website', 'Announcement feed')}
      </div></div>
      <div class="card"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Resource library</h2>${write ? `<button class="btn btn-sm btn-outline-primary" onclick="addResource()">${icon('upload', 'me-1')} Upload</button>` : ''}</div><div class="list-group list-group-flush">
        ${Object.entries(groups).map(([cat, items]) => `<div class="list-group-item bg-body-tertiary small fw-semibold">${icon('folder2', 'me-1')}${esc(cat)} <span class="text-body-secondary fw-normal">(${items.length})</span></div>`
          + items.map(r => `<div class="list-group-item d-flex align-items-center gap-2 small"><div class="flex-grow-1 min-w-0"><div class="fw-medium text-truncate">${esc(r.title)}</div><div class="text-body-secondary">${esc(r.filename)} · ${fmtDate(r.createdAt)}</div></div>
            <button class="btn btn-sm btn-light" title="Download" onclick="getFile(${jsArg(`/admin/resources/${r.id}/download`)},this)">${icon('download')}</button>${write ? `<button class="btn btn-sm btn-light" title="Remove" onclick="removeResource(${jsArg(r.id)})">${icon('trash')}</button>` : ''}</div>`).join('')).join('') || empty('No documents in the library yet.', 'folder2')}
      </div></div>
    </div></div>`;
}
function removeAnnouncement(id) {
  const a = ANNOUNCEMENTS.find(x => x.id === id);
  asyncModal({
    title: 'Remove announcement', confirmText: 'Remove', tone: 'danger', body: `<p class="mb-0">Remove “${esc(a?.title)}” from the website and member portal?</p>`,
    onSubmit: async () => { await adm(`/announcements/${id}`, { method: 'DELETE' }); done('Announcement removed'); },
  });
}
function newAnnouncement() {
  asyncModal({
    title: 'New announcement', confirmText: 'Publish', size: 'lg',
    body: `<div class="row g-3"><div class="col-md-8"><label class="form-label small fw-medium">Title</label><input class="form-control" name="title" required><div class="invalid-feedback">Required.</div></div>
      <div class="col-md-4"><label class="form-label small fw-medium">Tag</label><input class="form-control" name="tag" required value="Notice" list="anntags"><datalist id="anntags"><option>Notice</option><option>Renewals</option><option>Compliance</option><option>Events</option><option>Platform</option></datalist></div>
      <div class="col-12"><label class="form-label small fw-medium">Text</label><textarea class="form-control" name="body" rows="4" required></textarea><div class="invalid-feedback">Required.</div></div></div>`,
    onSubmit: async v => { await adm('/announcements', { method: 'POST', body: v }); done('Announcement published'); },
  });
}
async function broadcast(preset) {
  let auds;
  try { auds = await adm('/broadcasts/audiences'); } catch (e) { return fail(e); }
  const dues = preset === 'DUES_DUE';
  asyncModal({
    title: 'New broadcast', confirmText: `${icon('send', 'me-1')} Send`, size: 'lg', busyText: 'Sending…',
    body: `<div class="row g-3">
      <div class="col-md-6"><label class="form-label small fw-medium">Audience</label><select class="form-select" name="audience">${auds.map(a => `<option value="${esc(a.key)}" ${a.key === (preset || 'ALL') ? 'selected' : ''}>${esc(a.label)} (${a.count})</option>`).join('')}</select></div>
      <div class="col-md-6"><label class="form-label small fw-medium d-block">Channels</label>
        ${['EMAIL', 'SMS', 'PORTAL'].map(c => `<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" name="ch_${c}" id="ch_${c}" ${c !== 'PORTAL' || !dues ? 'checked' : ''}><label class="form-check-label small" for="ch_${c}">${{ EMAIL: 'Email', SMS: 'SMS', PORTAL: 'Portal' }[c]}</label></div>`).join('')}</div>
      <div class="col-12"><label class="form-label small fw-medium">Subject</label><input class="form-control" name="subject" required value="${dues ? 'Reminder: membership dues due' : `${new Date().getFullYear() + 1} membership renewals now open`}"><div class="invalid-feedback">Required.</div></div>
      <div class="col-12"><label class="form-label small fw-medium">Message</label><textarea class="form-control" name="body" rows="4" required>${dues ? 'Dear member, our records show your annual dues are due. Pay online in the member portal to keep your accreditation active.' : 'Dear member, renew before your accreditation expires to keep your listing in the public directory. Pay online in the member portal.'}</textarea><div class="invalid-feedback">Required.</div></div>
    </div>`,
    onSubmit: async v => {
      const channels = ['EMAIL', 'SMS', 'PORTAL'].filter(c => v[`ch_${c}`]);
      if (!channels.length) throw new Error('Choose at least one channel.');
      const b = await adm('/broadcasts', { method: 'POST', body: { subject: v.subject, body: v.body, audience: v.audience, channels, tag: dues ? 'Dues' : 'Notice' } });
      done(`Broadcast queued for ${b.recipientCount} member${b.recipientCount === 1 ? '' : 's'}`);
    },
  });
}
function addResource() {
  asyncModal({
    title: 'Upload to the resource library', confirmText: 'Upload', busyText: 'Uploading…',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Title</label><input class="form-control" name="title" required><div class="invalid-feedback">Required.</div></div>
      <div class="mb-3"><label class="form-label small fw-medium">Category</label><input class="form-control" name="category" required list="rescats" value="BoZ & MoF circulars"><datalist id="rescats"><option>BoZ & MoF circulars</option><option>Templates & forms</option><option>MLAZ constitution & code of conduct</option><option>Training materials</option></datalist></div>
      <label class="form-label small fw-medium">File <span class="text-body-secondary fw-normal">(PDF, JPG or PNG, up to 10 MB)</span></label><input class="form-control" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Choose a file.</div>`,
    onSubmit: async (v, form) => { await adm('/resources', { method: 'POST', form: new FormData(form) }); done('Added to the resource library'); },
  });
}
function removeResource(id) {
  asyncModal({
    title: 'Remove resource', confirmText: 'Remove', tone: 'danger', body: '<p class="mb-0">Remove this document from the member resource library?</p>',
    onSubmit: async () => { await adm(`/resources/${id}`, { method: 'DELETE' }); done('Resource removed'); },
  });
}

/* ================= EVENTS ================= */
let EV_PAST = false;
const toggleEventsPast = () => { EV_PAST = !EV_PAST; rerender(); };
async function events() {
  const list = await adm(`/events?past=${EV_PAST}`);
  return pageHeader('Events', 'AGMs, trainings and webinars for members',
    `<button class="btn btn-outline-secondary" onclick="toggleEventsPast()">${EV_PAST ? 'Upcoming only' : 'Include past events'}</button>${can('events:write') ? `<button class="btn btn-primary" onclick="newEvent()">${icon('plus-lg', 'me-1')} New event</button>` : ''}`)
    + `<div class="row g-3">${list.map(e => { const pct = Math.min(100, Math.round(e.registered / e.capacity * 100)); return `<div class="col-md-6 col-xl-4"><div class="card h-100 ${e.status === 'CANCELLED' ? 'opacity-75' : ''}"><div class="card-body d-flex flex-column">
      <div class="d-flex justify-content-between mb-2"><span class="badge bg-info-subtle text-info-emphasis">${esc(EVENT_TYPE[e.type] || e.type)}</span>${e.status === 'CANCELLED' ? '<span class="badge bg-danger-subtle text-danger-emphasis">Cancelled</span>' : `<span class="small text-body-secondary">${fmtDate(e.date)}</span>`}</div>
      <h2 class="h6 fw-semibold mb-1">${esc(e.name)}</h2><div class="small text-body-secondary mb-2">${icon('geo-alt', 'me-1')}${esc(e.venue)}</div>
      <div class="d-flex justify-content-between small mb-3"><span class="fw-semibold">${icon('ticket-perforated', 'me-1 text-primary')}${e.price ? `${K(e.price)} per ticket` : 'Free'}</span>${e.price ? `<span class="text-body-secondary">${K(e.revenue)} collected</span>` : ''}</div>
      <div class="mt-auto"><div class="d-flex justify-content-between small mb-1"><span>${e.registered} / ${e.capacity} registered</span><span class="text-body-secondary">${pct}%</span></div>
      <div class="progress mb-3" style="height:6px"><div class="progress-bar" style="width:${pct}%"></div></div>
      <button class="btn btn-outline-secondary btn-sm w-100" onclick="manageEvent(${jsArg(e.id)})">Manage</button></div>
    </div></div></div>`; }).join('') || `<div class="col-12">${empty(EV_PAST ? 'No events yet.' : 'No upcoming events.', 'calendar')}</div>`}</div>`;
}
function newEvent() {
  asyncModal({
    title: 'New event', confirmText: 'Create event',
    body: `<div class="row g-3"><div class="col-12"><label class="form-label small fw-medium">Event name</label><input class="form-control" name="name" required><div class="invalid-feedback">Required.</div></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Date</label><input class="form-control" type="date" name="date" min="${today()}" required><div class="invalid-feedback">Choose a date from today.</div></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Type</label><select class="form-select" name="type">${Object.entries(EVENT_TYPE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label small fw-medium">Venue</label><input class="form-control" name="venue" required><div class="invalid-feedback">Required.</div></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Capacity</label><input class="form-control" type="number" name="capacity" min="1" value="100" required></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Price per ticket (K)</label><input class="form-control" type="number" name="price" min="0" step="1" value="0" required><div class="form-text">Use 0 for a free event.</div></div>
      <div class="col-12"><label class="form-label small fw-medium">Description <span class="text-body-secondary fw-normal">(optional)</span></label><textarea class="form-control" name="description" rows="2"></textarea></div></div>`,
    onSubmit: async v => { await adm('/events', { method: 'POST', body: { ...v, capacity: Number(v.capacity), price: Number(v.price) } }); done('Event published to members'); },
  });
}
async function manageEvent(id) {
  let e;
  try { e = await adm(`/events/${id}`); } catch (err) { return fail(err); }
  const row = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom"><span class="text-body-secondary">${k}</span><b>${v}</b></div>`;
  const editable = can('events:write') && e.status === 'PUBLISHED';
  const regStatus = r => r.status === 'PENDING' ? '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis">Payment pending</span>'
    : r.status === 'CONFIRMED' ? '<span class="badge rounded-pill bg-success-subtle text-success-emphasis">Confirmed</span>'
      : `<span class="badge rounded-pill bg-secondary-subtle text-secondary-emphasis">Cancelled</span>${r.refundDue ? ` <span class="badge rounded-pill bg-danger-subtle text-danger-emphasis">Refund due</span>${can('payments:record') ? ` <button class="btn btn-sm btn-outline-primary py-0" data-refund="${esc(r.id)}">Record refund</button>` : ''}` : r.refundedAt ? ` <span class="badge rounded-pill bg-success-subtle text-success-emphasis" title="${esc(`Ref ${r.refundRef} · ${r.refundedBy}`)}">Refunded</span>` : ''}`;
  const el = modal({
    title: esc(e.name), size: 'lg',
    body: `${e.status === 'CANCELLED' ? note('danger', 'x-octagon', `<b>Cancelled.</b> ${esc(e.cancelReason || '')}`) : ''}
      <div class="small mb-3">${row('Date', fmtDate(e.date))}${row('Venue', esc(e.venue))}${row('Registrations', `${e.registered} / ${e.capacity}`)}${row('Revenue collected', K(e.revenue))}</div>
      ${editable ? `<form class="row g-2 align-items-end mb-4" novalidate data-edit>
        <div class="col-sm-5"><label class="form-label small fw-medium">Price per ticket (K)</label><input class="form-control" type="number" name="price" min="0" step="1" value="${e.price}" required></div>
        <div class="col-sm-4"><label class="form-label small fw-medium">Capacity</label><input class="form-control" type="number" name="capacity" min="${Math.max(1, e.registered)}" value="${e.capacity}" required><div class="invalid-feedback">At least ${Math.max(1, e.registered)}.</div></div>
        <div class="col-sm-3"><button class="btn btn-outline-primary w-100">Save</button></div>
        <div class="col-12 form-text">Price changes apply to new registrations only.</div></form>` : ''}
      <div class="small fw-semibold mb-2">Registrations</div>
      <div class="table-responsive"><table class="table table-sm small align-middle mb-0"><thead><tr><th>Member</th><th class="text-end">Tickets</th><th class="text-end">Amount</th><th>Payment</th><th>Status</th></tr></thead><tbody>
      ${e.registrations.map(r => `<tr><td><a href="#/app/members/${esc(r.member.number)}">${esc(r.member.name)}</a></td><td class="text-end">${r.tickets}</td><td class="text-end">${r.amount ? K(r.amount) : 'Free'}</td><td class="small">${r.payment ? `${esc(r.payment.ref)} · ${esc(lower(r.payment.status))}` : '—'}</td><td>${regStatus(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-body-secondary">No registrations yet.</td></tr>'}
      </tbody></table></div>`,
    footer: `${editable ? '<button class="btn btn-outline-danger me-auto" data-cancel>Cancel event</button>' : ''}<button class="btn btn-light" data-bs-dismiss="modal">Close</button>`,
  });
  el.querySelectorAll('[data-refund]').forEach(b => b.addEventListener('click', () => {
    const r = e.registrations.find(x => x.id === b.dataset.refund);
    el.close();
    setTimeout(() => asyncModal({
      title: 'Record refund', confirmText: 'Record refund',
      body: `<p class="small text-body-secondary">Record that ${K(r.amount)} was paid back to ${esc(r.member.name)} for ${esc(e.name)}. The member is told by email.</p>
        <label class="form-label small fw-medium">Refund reference (bank or mobile money)</label><input class="form-control" name="reference" required maxlength="80"><div class="invalid-feedback">Required.</div>`,
      onSubmit: async v => { await adm(`/events/registrations/${encodeURIComponent(r.id)}/refund`, { method: 'POST', body: v }); toast('Refund recorded'); },
    }), 300);
  }));
  const form = el.querySelector('[data-edit]');
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    const btn = form.querySelector('button');
    if (!form.checkValidity()) { form.querySelectorAll('input').forEach(i => i.classList.toggle('is-invalid', !i.checkValidity())); return; }
    busy(btn, true, 'Saving…');
    try { await adm(`/events/${id}`, { method: 'PATCH', body: { price: Number(form.price.value), capacity: Number(form.capacity.value) } }); el.close(); done('Event updated'); } catch (err) { busy(btn, false); fail(err); }
  };
  el.querySelector('[data-cancel]')?.addEventListener('click', () => {
    const paid = e.registrations.filter(r => r.status === 'CONFIRMED' && r.amount);
    el.close();
    setTimeout(() => asyncModal({
      title: 'Cancel event', confirmText: 'Cancel event', tone: 'danger',
      body: `<p>Cancel <b>${esc(e.name)}</b>? Registered members will be notified.</p>${paid.length ? note('warning', 'exclamation-triangle', `${paid.length} paid registration(s) will be flagged for refund.`) : ''}
        <label class="form-label small fw-medium">Reason (sent to members)</label><textarea class="form-control" name="reason" rows="2" required></textarea><div class="invalid-feedback">Give a reason.</div>`,
      onSubmit: async v => { await adm(`/events/${id}/cancel`, { method: 'POST', body: v }); done('Event cancelled; members have been told'); },
    }), 300);
  });
}

/* ================= REPORTS ================= */
const reportTable = ({ cols, rows }) => `<div class="table-responsive"><table class="table table-sm table-hover align-middle small mb-0"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="text-center text-body-secondary py-4">No records.</td></tr>`}</tbody></table></div>`;
async function reports() {
  const list = await adm('/reports');
  return pageHeader('Reports', 'Standard reports with export to Excel (CSV) and PDF')
    + `<div class="row g-3">${list.map(rp => `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
      <div class="d-flex gap-3 mb-2"><span class="icon-circle bg-primary-subtle text-primary-emphasis">${icon(rp.icon)}</span><div><h2 class="h6 fw-semibold mb-1">${esc(rp.title)}</h2><div class="small text-body-secondary">${esc(rp.description)}</div></div></div>
      <div class="d-flex gap-2 mt-auto pt-3"><button class="btn btn-sm btn-outline-secondary flex-grow-1" onclick="viewReport(${jsArg(rp.key)},this)">${icon('eye', 'me-1')} View</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="getFile('/admin/reports/${rp.key}?format=csv',this)" title="Opens in Excel">${icon('file-earmark-spreadsheet', 'me-1')} Excel</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="reportPdf(${jsArg(rp.key)},this)">${icon('file-earmark-pdf', 'me-1')} PDF</button></div>
    </div></div></div>`).join('')}</div>`;
}
async function viewReport(key, btn) {
  busy(btn, true, 'Loading…');
  try {
    const r = await adm(`/reports/${key}`);
    modal({ title: esc(r.title), size: 'xl', body: `<div class="small text-body-secondary mb-2">${r.rows.length} rows · generated ${fmtDateTime(r.generatedAt)}</div>${reportTable(r)}`,
      footer: `<button class="btn btn-light me-auto" data-bs-dismiss="modal">Close</button><button class="btn btn-outline-secondary" onclick="getFile(${jsArg(`/admin/reports/${encodeURIComponent(key)}?format=csv`)},this)">${icon('file-earmark-spreadsheet', 'me-1')} Excel</button><button class="btn btn-primary" onclick="reportPdf(${jsArg(key)},this)">${icon('file-earmark-pdf', 'me-1')} PDF</button>` });
  } catch (e) { fail(e); } finally { busy(btn, false); }
}
async function reportPdf(key, btn) {
  busy(btn, true, 'Preparing…');
  try {
    const r = await adm(`/reports/${key}`), st = getSession();
    printDoc(`MLAZ · ${r.title}`, `<div class="eyebrow">MONEY LENDERS ASSOCIATION OF ZAMBIA</div><h1 class="h4 mt-1">${esc(r.title)}</h1>
      <p class="small text-body-secondary">Generated ${fmtDateTime(r.generatedAt)}${st?.name ? ` by ${esc(st.name)}` : ''} · ${r.rows.length} rows</p>${reportTable(r)}`);
  } catch (e) { fail(e); } finally { busy(btn, false); }
}

/* ================= DIRECTORY & SETTINGS ================= */
let DIR_PAGE = 1;
const setDirPage = p => { DIR_PAGE = p; rerender(); };
async function directory() {
  const r = await adm(`/members${qs({ page: DIR_PAGE, pageSize: 50 })}`);
  return pageHeader('Public directory', 'What borrowers and regulators see when they verify a member', `<a class="btn btn-outline-secondary" href="#/directory" target="_blank">${icon('box-arrow-up-right', 'me-1')} Open public directory</a>`)
    + note('light border', 'info-circle', 'Only <b>active, accredited</b> members with a valid MoF authorization and paid dues are listed publicly and pass verification. The listing updates automatically.')
    + tableCard(['Member', 'Member no.', 'Town', 'Tier', 'Public listing'], r.items.map(m => `<tr class="clickable" onclick="nav('app/members/${esc(m.number)}')"><td class="fw-medium">${esc(m.name)}</td><td class="small font-monospace">${esc(m.number)}</td><td>${esc(m.town)}</td><td>${tierBadge(esc(m.tier))}</td>
      <td>${m.goodStanding ? '<span class="badge bg-success-subtle text-success-emphasis">Listed</span>' : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Hidden</span>'}</td></tr>`).join(''), 'No members yet.', pager(r, 'setDirPage'));
}

let SETTINGS = null, STAFF_LIST = [];
async function settings() {
  const manage = can('staff:manage');
  const [st, staff, failedMsgs] = await Promise.all([adm('/settings'), manage ? adm('/staff') : [], manage ? adm('/notifications?status=FAILED') : []]);
  SETTINGS = st; STAFF_LIST = staff;
  const write = can('settings:write');
  const row = (k, v, action = '') => `<div class="d-flex justify-content-between align-items-center gap-2 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="d-flex align-items-center gap-2"><b>${v}</b>${action}</span></div>`;
  const editBtn = (fn, title) => write ? `<button class="btn btn-sm btn-light" title="${title}" onclick="${fn}">${icon('pencil')}</button>` : '';
  const b = st.bankAccount, integ = st.integrations;
  const live = (ok, label) => `<span class="badge ${ok ? 'bg-success-subtle text-success-emphasis' : 'bg-warning-subtle text-warning-emphasis'}">${label}</span>`;
  return pageHeader('Settings', 'Your account, tiers, fees, bank account, staff accounts and integrations')
    + `<div class="row g-3">
      <div class="col-lg-6">${accountCard()}</div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Membership tiers & fees</h2>${editBtn('editFees()', 'Edit fees')}</div><div class="card-body">
        ${st.tiers.map(t => row(`${esc(t.name)}: annual dues${t.active ? '' : ' (inactive)'}`, K(t.annualDues), editBtn(`editTier(${jsArg(t.name)})`, `Edit ${esc(t.name)}`))).join('')}
        ${row('Joining fee', K(st.joiningFee))}${row('Dues payable from', `${st.renewalWindowDays} days before expiry`)}${row('Renewal cycle', 'Annual, from the accreditation date')}</div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Bank account for transfers</h2>${editBtn('editBank()', 'Edit bank account')}</div><div class="card-body">
        ${row('Bank', esc(b.bank))}${row('Account name', esc(b.name))}${row('Account number', `<span class="font-monospace">${esc(b.number)}</span>`)}${row('Branch', esc(b.branch))}
        <div class="small text-body-secondary mt-3">Shown to members and applicants who choose to pay by bank transfer.</div></div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Roles</h2></div><div class="list-group list-group-flush">
        ${[['Secretariat Admin', 'Full access · approves recommendations (checker)'], ['Membership Officer', 'Applications, members, MoF renewals · recommends (maker)'], ['Finance Officer', 'Payments, bank transfer review, dues, expenses'], ['Communications Officer', 'Announcements, broadcasts, resources, events'], ['Member', 'Own business profile, dues, certificates, events']].map(([n, d]) => listItem('person', 'secondary', n, d)).join('')}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Integrations</h2></div><div class="list-group list-group-flush">
        ${listItem('phone', 'info', 'Payments (mobile money, QR, card)', `Provider: ${esc(integ.payments)}`, live(integ.payments !== 'sandbox', integ.payments === 'sandbox' ? 'Sandbox' : 'Live'))}
        ${listItem('envelope', 'info', 'Email', integ.email === 'smtp' ? 'SMTP' : 'Logged to the server console', live(integ.email === 'smtp', integ.email === 'smtp' ? 'Connected' : 'Not connected'))}
        ${listItem('chat-dots', 'info', 'SMS gateway', `Driver: ${esc(integ.sms)}`, live(integ.sms !== 'log', integ.sms === 'log' ? 'Not connected' : 'Connected'))}
        ${listItem('hdd', 'info', 'Document storage', integ.storage === 's3' ? 'S3 bucket' : 'Server disk', live(true, 'Connected'))}
        ${listItem('search', 'info', 'Credit bureau', `Driver: ${esc(integ.creditBureau)}`, live(integ.creditBureau !== 'simulated', integ.creditBureau === 'simulated' ? 'Simulated' : 'Live'))}
        ${listItem('building', 'info', 'ZRA TPIN lookup', 'Format check only', live(false, 'Not connected'))}
      </div></div></div>
      ${manage ? `<div class="col-12"><div class="card"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Staff accounts</h2><button class="btn btn-sm btn-primary" onclick="inviteStaff()">${icon('person-plus', 'me-1')} Add staff</button></div>
        <div class="table-responsive"><table class="table align-middle mb-0 small"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Two-factor</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${staff.map(u => `<tr class="${u.active ? '' : 'text-body-secondary'}"><td class="fw-medium">${esc(u.name)}${u.title && u.title !== u.roleLabel ? `<div class="text-body-secondary fw-normal">${esc(u.title)}</div>` : ''}</td><td>${esc(u.email)}</td><td>${esc(u.roleLabel)}</td>
          <td>${!u.active ? '<span class="badge bg-secondary-subtle text-secondary-emphasis">Deactivated</span>' : u.invitePending ? '<span class="badge bg-warning-subtle text-warning-emphasis">Invite pending</span>' : '<span class="badge bg-success-subtle text-success-emphasis">Active</span>'}</td>
          <td>${u.mfaEnabled ? `<span class="text-success-emphasis">${icon('shield-check', 'me-1')}On</span>` : '<span class="text-warning-emphasis">Off</span>'}</td>
          <td>${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>
          <td class="text-end text-nowrap">${u.invitePending && u.active ? `<button class="btn btn-sm btn-light" onclick="resendStaffInvite(${jsArg(u.id)},this)">Resend invite</button>` : ''}<button class="btn btn-sm btn-light" title="Edit" onclick="editStaff(${jsArg(u.id)})">${icon('pencil')}</button></td></tr>`).join('')}
        </tbody></table></div></div></div>
      <div class="col-12"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Message delivery problems</h2></div>
        ${failedMsgs.length ? `<div class="table-responsive"><table class="table align-middle mb-0 small"><thead><tr><th>When</th><th>Channel</th><th>To</th><th>Subject</th><th>Error</th><th></th></tr></thead><tbody>
          ${failedMsgs.map(n => `<tr><td>${fmtDateTime(n.createdAt)}</td><td>${esc(n.channel)}</td><td>${esc(n.to)}</td><td>${esc(n.subject || '—')}</td><td class="text-danger-emphasis">${esc(n.lastError || '')}</td>
            <td class="text-end"><button class="btn btn-sm btn-light" onclick="retryMessage(${jsArg(n.id)},this)">Retry</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="card-body small text-body-secondary">${icon('check2-circle', 'me-1 text-success')}All emails and SMS were delivered.</div>`}</div></div>` : ''}
    </div>`;
}
function editTier(name) {
  const t = SETTINGS.tiers.find(x => x.name === name);
  asyncModal({
    title: `${esc(name)} tier`, confirmText: 'Save',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Annual dues (K)</label><input class="form-control" type="number" name="annualDues" min="0" step="1" value="${t.annualDues}" required></div>
      <label class="form-label small fw-medium">Description</label><textarea class="form-control" name="description" rows="2">${esc(t.description)}</textarea>
      <div class="form-text">New dues apply to payments started from now on.</div>`,
    onSubmit: async v => { await adm(`/settings/tiers/${encodeURIComponent(name)}`, { method: 'PUT', body: { annualDues: Number(v.annualDues), description: v.description } }); done(`${name} tier saved`); },
  });
}
function editFees() {
  asyncModal({
    title: 'Fees', confirmText: 'Save',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Joining fee (K)</label><input class="form-control" type="number" name="joiningFee" min="0" step="1" value="${SETTINGS.joiningFee}" required></div>
      <label class="form-label small fw-medium">Dues payable this many days before expiry</label><input class="form-control" type="number" name="renewalWindowDays" min="0" max="365" value="${SETTINGS.renewalWindowDays}" required>`,
    onSubmit: async v => { await adm('/settings/fees', { method: 'PUT', body: { joiningFee: Number(v.joiningFee), renewalWindowDays: Number(v.renewalWindowDays) } }); done('Fees saved'); },
  });
}
function editBank() {
  const b = SETTINGS.bankAccount;
  const f = (n, l) => `<div class="mb-3"><label class="form-label small fw-medium">${l}</label><input class="form-control" name="${n}" value="${esc(b[n])}" required><div class="invalid-feedback">Required.</div></div>`;
  asyncModal({
    title: 'Bank account', confirmText: 'Save', body: f('bank', 'Bank') + f('name', 'Account name') + f('number', 'Account number') + f('branch', 'Branch'),
    onSubmit: async v => { await adm('/settings/bank-account', { method: 'PUT', body: v }); done('Bank account saved'); },
  });
}
const roleOptions = sel => SETTINGS.roles.map(r => `<option value="${r.role}" ${r.role === sel ? 'selected' : ''}>${esc(r.label)}</option>`).join('');
function inviteStaff() {
  asyncModal({
    title: 'Add staff member', confirmText: 'Send invitation',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Full name</label><input class="form-control" name="name" required><div class="invalid-feedback">Required.</div></div>
      <div class="mb-3"><label class="form-label small fw-medium">Email</label><input class="form-control" type="email" name="email" required placeholder="name@mlaz.org.zm"><div class="invalid-feedback">Enter a valid email.</div></div>
      <div class="mb-3"><label class="form-label small fw-medium">Role</label><select class="form-select" name="role">${roleOptions('MEMBERSHIP_OFFICER')}</select></div>
      <label class="form-label small fw-medium">Job title <span class="text-body-secondary fw-normal">(optional)</span></label><input class="form-control" name="title">`,
    onSubmit: async v => { await adm('/staff', { method: 'POST', body: { ...v, title: v.title || undefined } }); done(`Invitation sent to ${v.email}`); },
  });
}
function editStaff(id) {
  const u = STAFF_LIST.find(x => x.id === id); if (!u) return;
  asyncModal({
    title: `Edit ${esc(u.name)}`, confirmText: 'Save',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Role</label><select class="form-select" name="role">${roleOptions(u.role)}</select></div>
      <div class="mb-3"><label class="form-label small fw-medium">Job title</label><input class="form-control" name="title" value="${esc(u.title || '')}"></div>
      <div class="form-check"><input class="form-check-input" type="checkbox" name="active" id="staffactive" ${u.active ? 'checked' : ''}><label class="form-check-label small" for="staffactive">Account active (unticking signs them out everywhere)</label></div>
      ${u.mfaEnabled ? '<div class="form-check mt-2"><input class="form-check-input" type="checkbox" name="resetMfa" id="staffmfa"><label class="form-check-label small" for="staffmfa">Reset two-factor sign-in (lost phone): they sign in with their password and enrol again</label></div>' : ''}`,
    onSubmit: async v => {
      await adm(`/staff/${encodeURIComponent(id)}`, { method: 'PATCH', body: { role: v.role, title: v.title || null, active: v.active, ...(v.resetMfa && { resetMfa: true }) } });
      done('Staff account saved');
    },
  });
}
async function retryMessage(id, btn) {
  busy(btn, true, 'Queuing…');
  try { await adm(`/notifications/${encodeURIComponent(id)}/retry`, { method: 'POST' }); done('Message queued again'); } catch (e) { busy(btn, false); fail(e); }
}
async function resendStaffInvite(id, btn) {
  busy(btn, true, 'Sending…');
  try { await adm(`/staff/${id}/resend-invite`, { method: 'POST' }); toast('Invitation sent again'); } catch (e) { fail(e); } finally { busy(btn, false); }
}

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

export const ADMIN_PAGES = { dashboard, reports, members, applications, certificates, payments, communications, events, directory, settings };
expose({
  getFile, viewDoc, setMTab, setMQuery, setMPage, editMember, sendReminder, recordDues, suspendMember, reinstateMember, verifyRenewal, rejectRenewal, inviteUser,
  setAStage, setAQuery, setAPage, recommendApp, approveApp, declineRec, returnApp, rejectApp, recordAppPayment,
  setPTab, setPQuery, setPPage, reconcile, reviewPayment, addExpense, viewExpense,
  removeAnnouncement, newAnnouncement, broadcast, addResource, removeResource,
  toggleEventsPast, newEvent, manageEvent, viewReport, reportPdf, setDirPage,
  editTier, editFees, editBank, inviteStaff, editStaff, resendStaffInvite, setPortalUser, retryMessage,
});

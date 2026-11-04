import { can } from '../../../core/auth/permissions.js';
import { publicConfig } from '../../../core/reference-data.js';
import { EL, on } from '../../../core/events.js';
import { K, KM, empty, esc, fmtDate, icon, listItem, pageHeader, pctClass, statCard } from '../../../shared/ui/index.js';
import { adm } from '../shared/api.js';
import { appBadge } from '../shared/ui.js';

/* ================= DASHBOARD ================= */
const ATTENTION = {
  mof_to_verify: ['file-earmark-check', 'warning', t => ['nav', `app/applications/${encodeURIComponent(t)}`], 'Review'],
  awaiting_your_approval: ['person-check', 'primary', t => ['nav', `app/applications/${encodeURIComponent(t)}`], 'Review'],
  renewal_to_verify: ['file-earmark-check', 'warning', t => ['nav', `app/members/${encodeURIComponent(t)}`], 'Review'],
  bank_transfer_to_confirm: ['bank', 'info', t => ['reviewPayment', t], 'Review'],
  member_lapsed: ['hourglass-bottom', 'warning', t => ['nav', `app/members/${encodeURIComponent(t)}`], 'View'],
  member_suspended: ['exclamation-octagon', 'danger', t => ['nav', `app/members/${encodeURIComponent(t)}`], 'View'],
};

export async function dashboard() {
  const [d, cfg] = await Promise.all([adm('/dashboard'), publicConfig()]);
  const s = d.stats;
  const attention = d.attention.map(a => {
    const [ic, tone, go, label] = ATTENTION[a.kind] || ['info-circle', 'secondary', t => ['nav', `app/members/${encodeURIComponent(t)}`], 'View'];
    return listItem(ic, tone, esc(a.title), esc(a.detail), `<button class="btn btn-sm btn-outline-secondary" ${on('click', ...go(a.target))}>${label}</button>`);
  });
  if (s.duesDue && can('comms:write')) attention.push(listItem('envelope', 'info', `${Number(s.duesDue)} member${s.duesDue === 1 ? '' : 's'} with dues due`, 'Send a renewal reminder', `<button class="btn btn-sm btn-outline-secondary" ${on('click', 'broadcast', 'DUES_DUE')}>Notify</button>`));
  return pageHeader('Dashboard', `Overview as at ${fmtDate(d.asAt)}`,
    `${can('members:read') ? `<button class="btn btn-outline-secondary" ${on('click', 'getFile', '/admin/members/export.csv', EL)}>${icon('download', 'me-1')} Export members</button>` : ''}${can('applications:read') ? `<a class="btn btn-primary" href="#/app/applications">${icon('file-earmark-text', 'me-1')} Review applications</a>` : ''}`)
    // The server leaves out (null) figures this role may not see; only the rest are shown.
    + `<div class="row g-3 mb-4">${[
      statCard('Total members', Number(s.totalMembers), `${Number(s.lapsedOrSuspended)} lapsed or suspended`, 'people', 'primary'),
      statCard('Active & accredited', Number(s.accredited), `${Number(s.accreditedShare)}% of members`, 'patch-check', 'success'),
      statCard('Dues due', Number(s.duesDue), 'payable now or overdue', 'hourglass-split', 'warning'),
      s.collectedYtd !== null && statCard('Collected (YTD)', KM(s.collectedYtd), 'successful payments this year', 'cash-stack', 'info'),
      s.openApplications !== null && statCard('Open applications', Number(s.openApplications), 'in the pipeline', 'inboxes', 'secondary'),
      statCard('MoF documents to verify', Number(s.mofToVerify), s.awaitingApproval !== null ? `new & renewals · ${Number(s.awaitingApproval)} awaiting approval` : 'renewals', 'file-earmark-check', 'warning'),
      s.awaitingPayment !== null && statCard('Awaiting payment', Number(s.awaitingPayment), 'certificate issues on payment', 'credit-card', 'success'),
      statCard('Lapsed / suspended', Number(s.lapsedOrSuspended), 'need follow-up', 'exclamation-octagon', 'danger'),
    ].filter(Boolean).map(c => `<div class="col-sm-6 col-xl-3">${c}</div>`).join('')}</div>
    <div class="row g-3 mb-4">
      <div class="col-xl-6"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Membership growth</h2><span class="ms-auto small text-body-secondary">Last 6 months</span></div><div class="card-body">${growthChart(d.growth)}</div></div></div>
      <div class="col-md-6 col-xl-3"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Members by tier</h2></div><div class="card-body">${tierBars(d.tiers, cfg.tiers)}</div></div></div>
      <div class="col-md-6 col-xl-3"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Members by region</h2></div><div class="card-body">${regionBars(d.regions)}</div></div></div>
    </div>
    <div class="row g-3">
      <div class="col-lg-7"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Onboarding pipeline</h2>${can('applications:read') ? '<a class="ms-auto small" href="#/app/applications">View all</a>' : ''}</div>
        ${d.pipeline.length ? `<div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Applicant</th><th>Town</th><th>Stage</th><th>Submitted</th></tr></thead><tbody>
        ${d.pipeline.map(a => `<tr class="${can('applications:read') ? 'clickable' : ''}" ${can('applications:read') ? on('click', 'nav', `app/applications/${encodeURIComponent(a.ref)}`) : ''}><td class="fw-medium">${esc(a.businessName)}</td><td>${esc(a.town)}</td><td>${appBadge(a)}</td><td class="small text-body-secondary">${fmtDate(a.submittedAt)}</td></tr>`).join('')}</tbody></table></div>` : empty('No open applications.')}
      </div></div>
      <div class="col-lg-5"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Needs attention</h2></div>
        <div class="list-group list-group-flush">${attention.join('') || empty("You're all caught up.", 'check2-circle')}</div>
      </div></div>
    </div>`;
}
function growthChart(points) {
  const d = points.map(p => Number(p.members) || 0), lab = points.map(p => new Date(`${p.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }));
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
  const colors = { Gold: 'bar-gold', Silver: 'bar-silver', Bronze: 'bar-bronze' }; // classes in styles.scss
  const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  const sorted = [...tiers].sort((a, b) => b.annualDues - a.annualDues);
  return sorted.map(t => { const n = Number(counts[t.name]) || 0; return `<div class="mb-3"><div class="d-flex justify-content-between small mb-1"><span class="fw-medium">${esc(t.name)}</span><span class="text-body-secondary">${n} · ${Math.round(n / total * 100)}%</span></div>
    <div class="progress progress-sm"><div class="progress-bar ${colors[t.name] || 'bar-brand'} ${pctClass(n / total * 100)}"></div></div></div>`; }).join('')
    + `<div class="border-top pt-3 mt-4 small d-flex justify-content-between gap-2"><span class="text-body-secondary">Annual dues</span><span class="fw-medium text-end">${sorted.map(t => `${esc(t.name)} ${K(t.annualDues)}`).join(' · ')}</span></div>`;
}
function regionBars(regions) {
  const sorted = Object.entries(regions).map(([k, v]) => [k, Number(v) || 0]);
  if (!sorted.length) return empty('No members yet.');
  const rows = sorted.length > 7 ? [...sorted.slice(0, 6), ['Other provinces', sorted.slice(6).reduce((n, [, v]) => n + v, 0)]] : sorted, max = sorted[0][1];
  return rows.map(([k, n]) => `<div class="mb-2"><div class="d-flex justify-content-between small mb-1"><span class="fw-medium">${esc(k)}</span><span class="text-body-secondary">${n}</span></div>
    <div class="progress progress-xs"><div class="progress-bar bar-brand ${pctClass(n / (max || 1) * 100)}"></div></div></div>`).join('');
}

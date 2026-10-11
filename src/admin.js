import {
  S, commit, nextId, esc, K, KM, fmtDate, today, plusYear, TIERDUES, JOINING_FEE, totals, counts, memberById, appById, inGoodStanding,
  certNo, log, addPayment, icon, avatar, statusBadge, tierBadge, accredBadge, mofBadge, duesBadge, stageBadge, payBadge, pageHeader,
  statCard, stepper, empty, listItem, toast, modal, confirmModal, readForm, viewCert, nav, rerender, expose, getDoc, deleteDoc,
} from './ui.js';

const crumb = (href, label, current) => `<li class="breadcrumb-item"><a href="#/app/${href}">${label}</a></li><li class="breadcrumb-item active">${esc(current)}</li>`;
const tableCard = (head, rows, emptyText) => `<div class="card"><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr>${head.map(h => `<th class="${h.startsWith('#') ? 'text-end' : ''}">${h.replace('#', '')}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}">${empty(emptyText)}</td></tr>`}</tbody></table></div></div>`;

/* ================= DASHBOARD ================= */
function dashboard() {
  const t = totals(), c = counts();
  const lapsed = S.members.filter(m => m.status !== 'active');
  const open = S.apps.filter(a => a.stage !== 'accredited');
  const attention = [
    ...S.apps.filter(a => a.stage === 'mof_review').map(a => listItem('file-earmark-check', 'warning', 'MoF authorization to verify', `${esc(a.name)} · ${esc(a.mofRef)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${a.id}">Review</a>`)),
    ...S.members.filter(m => m.mofRenewalPending).map(m => listItem('file-earmark-check', 'warning', 'MoF renewal to verify', `${esc(m.name)} · ${esc(m.mofRenewalRef)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/members/${m.id}">Review</a>`)),
    ...S.apps.filter(a => a.stage === 'ready_accredit').map(a => listItem('award', 'success', 'Accreditation ready to issue', `${esc(a.name)} · MoF verified, paid`, `<button class="btn btn-sm btn-primary" onclick="issueAccreditation('${a.id}')">Issue</button>`)),
    ...lapsed.map(m => listItem('exclamation-octagon', 'danger', `${esc(m.name)} ${m.status}`, m.mof !== 'valid' ? 'MoF authorization expired' : 'Dues and accreditation lapsed', `<a class="btn btn-sm btn-outline-secondary" href="#/app/members/${m.id}">View</a>`)),
  ];
  return pageHeader('Dashboard', `Overview as at ${fmtDate(new Date())}`,
    `<button class="btn btn-outline-secondary" onclick="exportMembers()">${icon('download', 'me-1')} Export</button><a class="btn btn-primary" href="#/app/applications">${icon('file-earmark-text', 'me-1')} Review applications</a>`)
    + `<div class="row g-3 mb-3">
      <div class="col-sm-6 col-xl-3">${statCard('Total members', t.totalMembers, `+${S.members.length + 11} this quarter`, 'people', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Active & accredited', t.accredited, `${(t.accredited / t.totalMembers * 100).toFixed(1)}% of members`, 'patch-check', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Dues outstanding', t.outstanding, `${KM(t.outstanding * 3840)} expected`, 'hourglass-split', 'warning')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Collected (YTD)', KM(t.collected), '82% collection rate', 'cash-stack', 'info')}</div>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('Open applications', open.length, 'in the pipeline', 'inboxes', 'secondary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('MoF documents to verify', c.mofReview, 'new & renewals', 'file-earmark-check', 'warning')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Accreditations to issue', c.ready, 'verified & paid', 'award', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Lapsed / suspended', lapsed.length, 'need follow-up', 'exclamation-octagon', 'danger')}</div>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-lg-7"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Membership growth</h2><span class="ms-auto small text-body-secondary">Last 6 months</span></div><div class="card-body">${growthChart(t.totalMembers)}</div></div></div>
      <div class="col-lg-5"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Members by tier</h2></div><div class="card-body">${tierBars(t)}</div></div></div>
    </div>
    <div class="row g-3">
      <div class="col-lg-7"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Onboarding pipeline</h2><a class="ms-auto small" href="#/app/applications">View all</a></div>
        ${open.length ? `<div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Applicant</th><th>Town</th><th>Stage</th><th>Submitted</th></tr></thead><tbody>
        ${open.map(a => `<tr class="clickable" onclick="nav('app/applications/${a.id}')"><td class="fw-medium">${esc(a.name)}</td><td>${esc(a.town)}</td><td>${stageBadge(a.stage)}</td><td class="small text-body-secondary">${esc(a.submitted)}</td></tr>`).join('')}</tbody></table></div>` : empty('No open applications.')}
      </div></div>
      <div class="col-lg-5"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Needs attention</h2></div>
        <div class="list-group list-group-flush">${attention.join('') || empty("You're all caught up.", 'check2-circle')}
        ${listItem('envelope', 'info', `${t.outstanding} members with dues outstanding`, 'Send a renewal reminder', '<button class="btn btn-sm btn-outline-secondary" onclick="broadcast(\'dues\')">Notify</button>')}</div>
      </div></div>
    </div>`;
}
function growthChart(current) {
  const d = [current - 52, current - 40, current - 31, current - 22, current - 11, current], lab = [];
  for (let i = 5; i >= 0; i--) { const x = new Date(); x.setMonth(x.getMonth() - i); lab.push(x.toLocaleString('en-US', { month: 'short' })); }
  const min = d[0] - 20, max = current + 10, W = 560, H = 210, pad = 30;
  const pts = d.map((v, i) => [pad + i * ((W - 2 * pad) / 5), H - 24 - ((v - min) / (max - min)) * (H - 54)]);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(0) + ' ' + p[1].toFixed(0)).join(' ');
  const area = path + ` L ${pts[5][0]} ${H - 24} L ${pts[0][0]} ${H - 24} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Membership growth chart">
    ${[0, 1, 2, 3].map(i => `<line x1="${pad}" x2="${W - pad}" y1="${30 + i * ((H - 54) / 3)}" y2="${30 + i * ((H - 54) / 3)}" stroke="#eef1f5"/>`).join('')}
    <path d="${area}" fill="rgba(11,94,59,.08)"/><path d="${path}" fill="none" stroke="#0b5e3b" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#0b5e3b" stroke-width="2"><title>${lab[i]}: ${d[i]}</title></circle><text x="${p[0]}" y="${p[1] - 11}" font-size="11" fill="#5b6b7f" text-anchor="middle">${d[i]}</text><text x="${p[0]}" y="${H - 5}" font-size="11.5" fill="#5b6b7f" text-anchor="middle">${lab[i]}</text>`).join('')}</svg>`;
}
function tierBars(t) {
  const colors = { Gold: '#b7791f', Silver: '#64748b', Bronze: '#c2410c' };
  return Object.keys(colors).map(k => `<div class="mb-3"><div class="d-flex justify-content-between small mb-1"><span class="fw-medium">${k}</span><span class="text-body-secondary">${t.tiers[k]} · ${Math.round(t.tiers[k] / t.totalMembers * 100)}%</span></div>
    <div class="progress" style="height:8px"><div class="progress-bar" style="width:${t.tiers[k] / t.totalMembers * 100}%;background:${colors[k]}"></div></div></div>`).join('')
    + `<div class="border-top pt-3 mt-4 small d-flex justify-content-between"><span class="text-body-secondary">Annual dues</span><span class="fw-medium">Gold ${K(TIERDUES.Gold)} · Silver ${K(TIERDUES.Silver)} · Bronze ${K(TIERDUES.Bronze)}</span></div>`;
}
function exportMembers() {
  const cols = ['id', 'name', 'town', 'tier', 'status', 'mof', 'accred', 'duesPaid', 'expiry', 'contact', 'phone', 'email', 'joined'];
  const csv = [cols.join(',')].concat(S.members.map(m => cols.map(c => `"${String(m[c] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `mlaz-members-${today()}.csv`; a.click();
  toast('Member list exported');
}

/* ================= MEMBERS ================= */
let MFILTER = 'all';
const MATCH = { all: () => true, active: m => m.status === 'active', lapsed: m => m.status === 'lapsed', suspended: m => m.status === 'suspended', dues: m => !m.duesPaid };
function members(id) {
  if (id) return memberDetail(id);
  const rows = S.members.filter(MATCH[MFILTER]);
  const tab = (k, l) => `<li class="nav-item"><a class="nav-link ${MFILTER === k ? 'active' : ''}" href="javascript:void 0" onclick="setMFilter('${k}')">${l} <span class="badge rounded-pill ${MFILTER === k ? 'bg-white text-primary' : 'bg-secondary-subtle text-secondary-emphasis'} ms-1">${S.members.filter(MATCH[k]).length}</span></a></li>`;
  return pageHeader('Members', `${totals().totalMembers} members · ${S.members.length} shown in this prototype`,
    `<button class="btn btn-outline-secondary" onclick="exportMembers()">${icon('download', 'me-1')} Export CSV</button><a class="btn btn-primary" href="#/apply">${icon('plus-lg', 'me-1')} New application</a>`)
    + `<ul class="nav nav-pills small mb-3 gap-1">${tab('all', 'All')}${tab('active', 'Active')}${tab('lapsed', 'Lapsed')}${tab('suspended', 'Suspended')}${tab('dues', 'Dues outstanding')}</ul>`
    + tableCard(['Member', 'Member no.', 'Town', 'Tier', 'MoF', 'Accreditation', 'Dues', 'Status'], rows.map(m => `<tr class="clickable" onclick="nav('app/members/${m.id}')">
      <td><div class="d-flex align-items-center gap-2">${avatar(m.name, S.members.indexOf(m))}<div><div class="fw-medium">${esc(m.name)}</div><div class="small text-body-secondary">${esc(m.contact)}</div></div></div></td>
      <td class="small font-monospace">${m.id}</td><td>${esc(m.town)}</td><td>${tierBadge(m.tier)}</td><td>${mofBadge(m.mof)}</td><td>${accredBadge(m.accred)}</td><td>${duesBadge(m.duesPaid)}</td><td>${statusBadge(m.status)}</td></tr>`).join(''), 'No members match this filter.');
}
function setMFilter(k) { MFILTER = k; rerender(); }
function memberDetail(id) {
  const m = memberById(id); if (!m) return empty('Member not found.');
  const i = S.members.indexOf(m), canCert = m.accred === 'issued';
  const info = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
  return pageHeader(esc(m.name), `${m.id} · ${esc(m.town)} · member since ${fmtDate(m.joined)}`,
    `${canCert ? `<button class="btn btn-outline-secondary" onclick="viewCert('${m.id}')">${icon('award', 'me-1')} Certificate</button>` : ''}
     <button class="btn btn-outline-secondary" onclick="sendReminder('${m.id}')">${icon('envelope', 'me-1')} Send reminder</button>
     ${!m.duesPaid ? `<button class="btn btn-outline-secondary" onclick="recordDues('${m.id}')">${icon('cash', 'me-1')} Record dues payment</button>` : ''}
     ${m.status === 'suspended' ? `<button class="btn btn-primary" onclick="setStatus('${m.id}','active')">${icon('arrow-counterclockwise', 'me-1')} Reinstate</button>` : `<button class="btn btn-outline-danger" onclick="setStatus('${m.id}','suspended')">${icon('slash-circle', 'me-1')} Suspend</button>`}`,
    crumb('members', 'Members', m.name))
    + `<div class="row g-3">
      <div class="col-lg-4"><div class="card"><div class="card-body p-4">
        <div class="text-center mb-3">${avatar(m.name, i, true)}<h2 class="h5 mt-3 mb-1">${esc(m.name)}</h2><div class="d-flex justify-content-center gap-1">${tierBadge(m.tier)} ${statusBadge(m.status)}</div></div>
        ${info('Contact', esc(m.contact))}${info('Phone', esc(m.phone))}${info('Email', esc(m.email))}${info('PACRA no.', esc(m.pacra || 'On file'))}${info('Joined', fmtDate(m.joined))}
      </div></div></div>
      <div class="col-lg-8">
        <div class="row g-3 mb-3">
          <div class="col-md-4">${statCard('MoF authorization', mofBadge(m.mof), esc(m.mofRef || ''), 'file-earmark-check', 'info')}</div>
          <div class="col-md-4">${statCard('Accreditation', accredBadge(m.accred), `Expires ${fmtDate(m.expiry)}`, 'award', 'success')}</div>
          <div class="col-md-4">${statCard('Dues (current year)', duesBadge(m.duesPaid), `${m.tier} · ${K(TIERDUES[m.tier])}`, 'cash-stack', 'warning')}</div>
        </div>
        <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Documents</h2></div><div class="list-group list-group-flush">
          ${listItem('file-earmark-text', 'info', 'Ministry of Finance authorization', m.mofRenewalPending ? `Renewal ${esc(m.mofRenewalRef)} uploaded, awaiting verification` : `${esc(m.mofRef)} · ${m.mof === 'valid' ? 'verified' : 'expired'}`,
            m.mofRenewalPending ? `<button class="btn btn-sm btn-primary" onclick="verifyRenewal('${m.id}')">Verify renewal</button>` : mofBadge(m.mof))}
          ${listItem('award', 'success', 'MLAZ accreditation certificate', canCert ? `${certNo(m)} · QR-verifiable` : 'Not currently valid', canCert ? `<button class="btn btn-sm btn-outline-secondary" onclick="viewCert('${m.id}')">View</button>` : accredBadge(m.accred))}
          ${listItem('building', 'secondary', 'Certificate of incorporation (PACRA)', esc(m.pacra || 'On file'), '<span class="small text-body-secondary">On file</span>')}
        </div></div>
        <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Activity</h2></div><div class="list-group list-group-flush">
          ${(m.activity || []).map(a => listItem(a.icon, a.tone, esc(a.title), esc(a.sub))).join('')}
          ${listItem('person-plus', 'primary', 'Joined MLAZ', fmtDate(m.joined))}
        </div></div>
      </div>
    </div>`;
}
function sendReminder(id) { const m = memberById(id); log(id, 'envelope', 'info', 'Reminder sent', `Email and SMS to ${m.contact} · ${fmtDate(new Date())}`); commit(); toast(`Reminder sent to ${m.name}`); rerender(); }
function setStatus(id, status) {
  const m = memberById(id);
  if (status === 'active') {
    if (m.mof !== 'valid') return toast('MoF authorization must be valid before reinstating', 'error');
    m.status = 'active'; m.accred = 'issued';
    log(id, 'arrow-counterclockwise', 'success', 'Membership reinstated', fmtDate(new Date())); commit(); toast(`${m.name} reinstated`); return rerender();
  }
  confirmModal({
    title: 'Suspend member', confirmText: 'Suspend', tone: 'danger',
    body: `<p>Suspending <b>${esc(m.name)}</b> revokes their accreditation and removes them from the public directory.</p><label class="form-label small fw-medium">Reason</label><textarea class="form-control" name="reason" rows="2" required>Non-compliance with the MLAZ code of conduct</textarea>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      m.status = 'suspended'; m.accred = 'revoked';
      log(id, 'slash-circle', 'danger', 'Membership suspended', v.reason); commit(); toast(`${m.name} suspended`); rerender();
    },
  });
}
function recordDues(id) {
  const m = memberById(id);
  confirmModal({
    title: 'Record dues payment', confirmText: 'Record payment',
    body: `<p class="small text-body-secondary">Record an offline payment of ${K(TIERDUES[m.tier])} for ${esc(m.name)}.</p>
      <div class="row g-3"><div class="col-6"><label class="form-label small fw-medium">Method</label><select class="form-select" name="method"><option>Bank transfer</option><option>Cash</option></select></div>
      <div class="col-6"><label class="form-label small fw-medium">Bank reference</label><input class="form-control" name="ref" required placeholder="e.g. ZNBC-889120"></div></div>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      addPayment(m.name, `Annual dues (${m.tier})`, TIERDUES[m.tier], v.method);
      m.duesPaid = true;
      if (m.status === 'lapsed' && m.mof === 'valid') { m.status = 'active'; m.accred = 'issued'; m.expiry = plusYear(); }
      log(id, 'credit-card', 'warning', 'Annual dues paid', `${K(TIERDUES[m.tier])} · ${v.method} · ${v.ref}`); commit(); toast('Payment recorded'); rerender();
    },
  });
}
function verifyRenewal(id) {
  const m = memberById(id);
  Object.assign(m, { mofRenewalPending: false, mof: 'valid', mofRef: m.mofRenewalRef || m.mofRef, expiry: plusYear() });
  if (m.status === 'suspended' && m.duesPaid) { m.status = 'active'; m.accred = 'issued'; }
  log(id, 'file-earmark-check', 'info', 'MoF renewal verified', `Valid until ${fmtDate(m.expiry)}`); commit(); toast('MoF renewal verified'); rerender();
}

/* ================= APPLICATIONS ================= */
const JOURNEY = ['Submitted', 'MoF authorization', 'Verification', 'Payment', 'Accredited'];
const STAGE_IDX = { details: 1, mof_review: 2, payment_pending: 3, ready_accredit: 4, accredited: 5 };
function applications(id) {
  if (id) return appDetail(id);
  return pageHeader('Applications', 'Self-onboarded lenders progressing to accredited membership', `<a class="btn btn-primary" href="#/apply">${icon('plus-lg', 'me-1')} New application</a>`)
    + `<div class="alert alert-light border d-flex gap-2 small">${icon('info-circle', 'text-primary')}<div>The Ministry of Finance authorization is verified <b>first</b>. Only then can the applicant pay and receive MLAZ accreditation.</div></div>`
    + tableCard(['Reference', 'Applicant', 'Town', 'Tier', 'MoF reference', 'Stage', 'Submitted'], S.apps.map(a => `<tr class="clickable" onclick="nav('app/applications/${a.id}')">
      <td class="small font-monospace">${a.id}</td><td><div class="fw-medium">${esc(a.name)}</div><div class="small text-body-secondary">${esc(a.contact)}</div></td><td>${esc(a.town)}</td><td>${tierBadge(a.tier)}</td>
      <td class="small">${esc(a.mofRef)}</td><td>${stageBadge(a.stage)}</td><td class="small text-body-secondary">${esc(a.submitted)}</td></tr>`).join(''), 'No applications yet.');
}
function appDetail(id) {
  const a = appById(id); if (!a) return empty('Application not found.');
  const fee = JOINING_FEE + TIERDUES[a.tier];
  let action = '';
  if (a.note && a.stage === 'details') action += `<div class="alert alert-danger small">${icon('arrow-return-left', 'me-1')} Returned to applicant: ${esc(a.note)}</div>`;
  if (a.stage === 'details') action += `<div class="alert alert-warning small d-flex gap-2">${icon('hourglass')}<div>The applicant has not yet uploaded their MoF authorization. They can do so from <b>Track application</b> using reference <b>${a.id}</b>.</div></div>
    <button class="btn btn-outline-secondary" onclick="toast('Reminder sent to ${esc(a.email || a.phone)}')">${icon('envelope', 'me-1')} Send reminder</button>`;
  else action += listItem('file-earmark-pdf', 'info', 'MoF money-lending authorization', `Ref ${esc(a.mofRef)}${a.mofExpiry ? ` · expires ${fmtDate(a.mofExpiry)}` : ''}${a.mofFile ? ` · ${esc(a.mofFile)}` : ''}`, `<div class="d-flex flex-wrap align-items-center justify-content-end gap-2">${a.stage === 'mof_review' ? '<span class="badge bg-warning-subtle text-warning-emphasis">Pending review</span>' : '<span class="badge bg-success-subtle text-success-emphasis">Verified</span>'}<button class="btn btn-sm btn-outline-primary" onclick="viewMof('${a.id}')">${icon('eye', 'me-1')} View document</button></div>`).replace('list-group-item', 'border rounded px-3 mb-3');
  if (a.stage === 'mof_review') action += `<div class="alert alert-info small d-flex gap-2">${icon('search')}<div>Check the authorization against the Ministry of Finance register before approving.</div></div>
    <div class="d-flex gap-2"><button class="btn btn-outline-danger" onclick="rejectMof('${a.id}')">Return to applicant</button><button class="btn btn-primary" onclick="verifyMof('${a.id}')">${icon('check-lg', 'me-1')} Verify authorization</button></div>`;
  if (a.stage === 'payment_pending') action += `<div class="alert alert-warning small d-flex gap-2">${icon('credit-card')}<div>Awaiting ${K(fee)} from the applicant (joining fee ${K(JOINING_FEE)} + ${a.tier} dues ${K(TIERDUES[a.tier])}). The applicant pays online from Track application.</div></div>
    <div class="d-flex gap-2"><button class="btn btn-outline-secondary" onclick="toast('Payment link sent by SMS and email')">${icon('send', 'me-1')} Resend payment link</button><button class="btn btn-outline-primary" onclick="recordAppPayment('${a.id}')">Record offline payment</button></div>`;
  if (a.stage === 'ready_accredit') action += `<div class="alert alert-success small d-flex gap-2">${icon('check-circle')}<div>MoF authorization verified and payment received. Ready to issue accreditation.</div></div>
    <button class="btn btn-primary" onclick="issueAccreditation('${a.id}')">${icon('award', 'me-1')} Generate accreditation certificate</button>`;
  if (a.stage === 'accredited') action += `<div class="alert alert-success small d-flex gap-2">${icon('award')}<div>Accredited as member <b>${a.memberId}</b>.</div></div><a class="btn btn-primary" href="#/app/members/${a.memberId}">Open member record</a>`;
  const info = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v || '—'}</span></div>`;
  return pageHeader(esc(a.name), `${a.id} · ${esc(a.town)} · submitted ${esc(a.submitted)}`, stageBadge(a.stage), crumb('applications', 'Applications', a.name))
    + `<div class="card mb-3"><div class="card-body py-4">${stepper(JOURNEY, STAGE_IDX[a.stage])}</div></div>
    <div class="row g-3">
      <div class="col-lg-7"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Ministry of Finance authorization</h2></div><div class="card-body">${action}</div></div></div>
      <div class="col-lg-5"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Applicant details</h2></div><div class="card-body">
        ${info('Business name', esc(a.name))}${info('PACRA no.', esc(a.pacra))}${info('Location', esc([a.town, a.province].filter(Boolean).join(', ')))}${info('Contact', esc([a.contact, a.position].filter(Boolean).join(', ')))}${info('Phone', esc(a.phone))}${info('Email', esc(a.email))}${info('Tier', tierBadge(a.tier))}
      </div></div></div>
    </div>`;
}
// Opens the uploaded MoF authorization. Sample applications have no file, so a placeholder letter is shown instead.
async function viewMof(id) {
  const a = appById(id), file = await getDoc(id);
  const url = file && URL.createObjectURL(file), name = a.mofFile || file?.name || 'authorization';
  const body = !file ? `<div class="alert alert-light border small d-flex gap-2">${icon('info-circle', 'text-primary')}<div>No file is stored for this sample application. Showing a placeholder of the authorization letter.</div></div>
      <div class="border rounded p-4 bg-white small" style="font-family:Georgia,serif">
        <div class="text-center mb-4"><div class="fw-bold">REPUBLIC OF ZAMBIA</div><div class="fw-bold">MINISTRY OF FINANCE AND NATIONAL PLANNING</div><div class="text-body-secondary">Money Lenders Act, Chapter 398 of the Laws of Zambia</div></div>
        <h3 class="h5 text-center mb-4">Certificate of Authorization to Carry on Money-Lending Business</h3>
        <p>This is to certify that <b>${esc(a.name)}</b>${a.pacra ? ` (PACRA ${esc(a.pacra)})` : ''} of ${esc(a.town)} is authorized to carry on the business of money lending in accordance with the Money Lenders Act.</p>
        <div class="d-flex flex-wrap gap-4 mt-4"><div><div class="text-body-secondary">Reference</div><b>${esc(a.mofRef)}</b></div>${a.mofExpiry ? `<div><div class="text-body-secondary">Valid until</div><b>${fmtDate(a.mofExpiry)}</b></div>` : ''}</div>
      </div>`
    : file.type.startsWith('image/') ? `<img src="${url}" alt="MoF authorization" class="img-fluid d-block mx-auto border rounded">`
    : `<iframe src="${url}" title="MoF authorization" class="w-100 border rounded" style="height:70vh"></iframe>`;
  const actions = a.stage === 'mof_review' ? `<button class="btn btn-outline-danger" data-reject>Return to applicant</button><button class="btn btn-primary" data-verify>${icon('check-lg', 'me-1')} Verify authorization</button>` : '';
  const el = modal({
    title: `MoF authorization · ${esc(a.name)}`, size: 'xl', body,
    footer: `${file ? `<a class="btn btn-light me-auto" href="${url}" download="${esc(name)}">${icon('download', 'me-1')} Download</a><a class="btn btn-light" href="${url}" target="_blank" rel="noopener">${icon('box-arrow-up-right', 'me-1')} Open in new tab</a>` : ''}
      <button class="btn btn-light" data-bs-dismiss="modal">Close</button>${actions}`,
  });
  if (url) el.addEventListener('hidden.bs.modal', () => URL.revokeObjectURL(url));
  el.querySelector('[data-verify]')?.addEventListener('click', () => { el.close(); verifyMof(id); });
  el.querySelector('[data-reject]')?.addEventListener('click', () => { el.close(); rejectMof(id); });
}
function verifyMof(id) { const a = appById(id); a.stage = 'payment_pending'; a.note = ''; commit(); toast('Authorization verified. Payment link sent to applicant'); rerender(); }
function rejectMof(id) {
  confirmModal({
    title: 'Return to applicant', confirmText: 'Return application', tone: 'danger',
    body: `<label class="form-label small fw-medium">Reason (sent to the applicant)</label><textarea class="form-control" name="reason" rows="3" required>Authorization reference not found on the Ministry of Finance register. Please upload a valid authorization.</textarea>`,
    onConfirm: el => { const v = readForm(el); if (!v) return false; Object.assign(appById(id), { stage: 'details', note: v.reason, mofRef: '—', mofFile: '' }); deleteDoc(id); commit(); toast('Application returned to applicant'); rerender(); },
  });
}
function recordAppPayment(id) {
  const a = appById(id);
  confirmModal({
    title: 'Record offline payment', confirmText: 'Record payment',
    body: `<p class="small text-body-secondary">Record ${K(JOINING_FEE + TIERDUES[a.tier])} received from ${esc(a.name)} outside the online checkout.</p>
      <div class="row g-3"><div class="col-6"><label class="form-label small fw-medium">Method</label><select class="form-select" name="method"><option>Bank transfer</option><option>Cash</option></select></div>
      <div class="col-6"><label class="form-label small fw-medium">Reference</label><input class="form-control" name="ref" required></div></div>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      addPayment(a.name, 'Joining fee', JOINING_FEE, v.method); addPayment(a.name, `Annual dues (${a.tier})`, TIERDUES[a.tier], v.method);
      a.stage = 'ready_accredit'; commit(); toast('Payment recorded'); rerender();
    },
  });
}
function issueAccreditation(appId) {
  const a = appById(appId);
  confirmModal({
    title: 'Generate accreditation', confirmText: 'Generate certificate',
    body: `<div class="alert alert-success small d-flex gap-2">${icon('check-circle')}<div>MoF authorization verified and fees received for <b>${esc(a.name)}</b>.</div></div>
      <div class="small"><div class="d-flex justify-content-between py-2 border-bottom"><span class="text-body-secondary">Certificate</span><b>MLAZ Accreditation ${new Date().getFullYear()}/${String(new Date().getFullYear() + 1).slice(2)}</b></div>
      <div class="d-flex justify-content-between py-2 border-bottom"><span class="text-body-secondary">Valid until</span><b>${fmtDate(plusYear())}</b></div>
      <div class="d-flex justify-content-between py-2"><span class="text-body-secondary">Delivery</span><b>Email to ${esc(a.email || a.contact)}</b></div></div>`,
    onConfirm: () => {
      const id = nextId('member', 'MLA-');
      S.members.push({
        id, name: a.name, town: a.town, tier: a.tier, status: 'active', mof: 'valid', mofRef: a.mofRef, accred: 'issued', duesPaid: true,
        expiry: plusYear(), contact: a.contact, phone: a.phone, email: a.email || '', joined: today(), pacra: a.pacra,
        activity: [{ icon: 'award', tone: 'success', title: 'Accreditation issued', sub: `Certificate generated ${fmtDate(new Date())}` }, { icon: 'credit-card', tone: 'warning', title: 'Joining fee and dues paid', sub: K(JOINING_FEE + TIERDUES[a.tier]) }],
      });
      a.stage = 'accredited'; a.memberId = id; commit(); toast('Accreditation certificate generated and emailed'); rerender();
      setTimeout(() => viewCert(id), 350);
    },
  });
}

/* ================= CERTIFICATES ================= */
function certificates() {
  const c = counts();
  const mof = S.apps.filter(a => a.stage === 'mof_review'), ready = S.apps.filter(a => a.stage === 'ready_accredit');
  const renewals = S.members.filter(m => m.mofRenewalPending);
  const issued = S.members.filter(m => m.accred === 'issued').sort((x, y) => y.joined.localeCompare(x.joined));
  return pageHeader('Certificates', 'Verify Ministry of Finance authorizations, then issue MLAZ accreditation')
    + `<div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('MoF to verify', c.mofReview, 'new & renewals', 'file-earmark-check', 'warning')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Ready to accredit', c.ready, 'verified & paid', 'award', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Accreditations issued', totals().accredited, 'currently valid', 'patch-check', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Expiring in 90 days', 74, 'renewal reminders scheduled', 'calendar-x', 'danger')}</div>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">1</span>MoF authorizations to verify</h2></div><div class="list-group list-group-flush">
        ${mof.map(a => listItem('file-earmark-text', 'warning', esc(a.name), `${esc(a.mofRef)} · new application`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${a.id}">Review</a>`)).join('')}
        ${renewals.map(m => listItem('file-earmark-text', 'info', esc(m.name), `${esc(m.mofRenewalRef)} · renewal`, `<button class="btn btn-sm btn-primary" onclick="verifyRenewal('${m.id}')">Verify</button>`)).join('')}
        ${mof.length + renewals.length ? '' : empty('Nothing waiting for verification.', 'check2-circle')}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">2</span>Accreditations ready to issue</h2></div><div class="list-group list-group-flush">
        ${ready.map(a => listItem('award', 'success', esc(a.name), 'MoF verified · fees paid', `<button class="btn btn-sm btn-primary" onclick="issueAccreditation('${a.id}')">Issue</button>`)).join('') || empty('No accreditations waiting.', 'check2-circle')}
      </div></div></div>
    </div>
    <h2 class="h6 mb-3">Issued accreditations</h2>`
    + tableCard(['Member', 'Certificate no.', 'Member since', 'Expires', 'Status', '#'], issued.map(m => `<tr><td class="fw-medium">${esc(m.name)}</td><td class="small font-monospace">${certNo(m)}</td><td class="small">${fmtDate(m.joined)}</td><td class="small">${fmtDate(m.expiry)}</td><td>${accredBadge(m.accred)}</td><td class="text-end"><button class="btn btn-sm btn-outline-secondary" onclick="viewCert('${m.id}')">View</button></td></tr>`).join(''), 'No certificates issued.');
}

/* ================= PAYMENTS ================= */
function payments() {
  const t = totals();
  const todays = S.payments.filter(p => p.status === 'success' && p.date.startsWith('Today')).reduce((a, p) => a + p.amt, 0);
  const mm = S.payments.filter(p => /MoMo|Money|Kwacha/.test(p.method)).length;
  return pageHeader('Payments & dues', 'Joining fees, annual dues and renewals across mobile money, card and bank',
    `<button class="btn btn-outline-secondary" onclick="reconcile()">${icon('arrow-repeat', 'me-1')} Reconcile</button><button class="btn btn-primary" onclick="broadcast('dues')">${icon('envelope', 'me-1')} Send dues reminders</button>`)
    + `<div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('Collected (YTD)', KM(t.collected), '82% collection rate', 'cash-stack', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Collected today', K(todays), `${S.payments.filter(p => p.date.startsWith('Today')).length} transactions`, 'graph-up-arrow', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Dues outstanding', t.outstanding, 'members', 'hourglass-split', 'warning')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Via mobile money', Math.round(mm / Math.max(S.payments.length, 1) * 100) + '%', 'of transactions', 'phone', 'info')}</div>
    </div>
    <div class="row g-3"><div class="col-xl-8">`
    + tableCard(['Reference', 'Payer', 'Description', 'Method', '#Amount', 'Status', '#'], S.payments.map(p => `<tr><td class="small font-monospace">${p.ref}</td><td><div class="fw-medium">${esc(p.member)}</div><div class="small text-body-secondary">${esc(p.date)}</div></td><td class="small">${esc(p.type)}</td><td class="small">${esc(p.method)}</td><td class="text-end fw-medium">${K(p.amt)}</td><td>${payBadge(p.status)}</td>
      <td class="text-end">${p.status === 'failed' ? `<button class="btn btn-sm btn-outline-secondary" onclick="retryPayment('${p.ref}')">Retry</button>` : ''}</td></tr>`).join(''), 'No payments yet.')
    + `</div><div class="col-xl-4"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Fee schedule</h2></div><div class="card-body small">
      ${['Gold', 'Silver', 'Bronze'].map(k => `<div class="d-flex justify-content-between py-2 border-bottom"><span>${k} <span class="text-body-secondary">(${t.tiers[k]} members)</span></span><b>${K(TIERDUES[k])} / yr</b></div>`).join('')}
      <div class="d-flex justify-content-between py-2"><span>Joining fee</span><b>${K(JOINING_FEE)} once</b></div>
      <div class="alert alert-light border mt-3 mb-0">${icon('phone', 'me-1 text-primary')} Members pay by MTN, Airtel or Zamtel mobile money, card or bank transfer. Receipts are issued automatically.</div>
    </div></div></div></div>`;
}
function reconcile() {
  const pend = S.payments.filter(p => p.status === 'pending'); pend.forEach(p => { p.status = 'success'; });
  commit(); toast(pend.length ? `Reconciled ${pend.length} pending payment(s)` : 'All payments are reconciled'); rerender();
}
function retryPayment(ref) {
  const p = S.payments.find(x => x.ref === ref); p.status = 'success'; p.date = 'Today ' + new Date().toTimeString().slice(0, 5);
  const m = S.members.find(x => x.name === p.member);
  if (m && /dues/i.test(p.type)) { m.duesPaid = true; log(m.id, 'credit-card', 'warning', 'Annual dues paid', `${K(p.amt)} · ${p.method}`); }
  commit(); toast('Payment collected successfully'); rerender();
}

/* ================= COMMUNICATIONS ================= */
function communications() {
  return pageHeader('Communications', 'Announcements, email and SMS broadcasts, and the member resource library', `<button class="btn btn-primary" onclick="broadcast()">${icon('megaphone', 'me-1')} New broadcast</button>`)
    + `<div class="row g-3"><div class="col-lg-8">
      <div class="card mb-3"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Announcements</h2><span class="ms-auto small text-body-secondary">Shown on the website and member portal</span></div><div class="list-group list-group-flush">
        ${S.announce.map((a, i) => listItem('megaphone', 'primary', esc(a.title), `${fmtDate(a.date)} · ${esc(a.body)}`, `<span class="badge bg-secondary-subtle text-secondary-emphasis">${esc(a.tag)}</span><button class="btn btn-sm btn-light" title="Remove" onclick="removeAnnouncement(${i})">${icon('trash')}</button>`)).join('') || empty('No announcements.')}
      </div></div>
      <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Sent broadcasts</h2></div><div class="list-group list-group-flush">
        ${S.broadcasts.map(b => listItem('send', 'info', esc(b.subject), `${esc(b.date)} · ${esc(b.audience)} · ${esc(b.channels)}`, '<span class="badge bg-success-subtle text-success-emphasis">Delivered</span>')).join('') || empty('No broadcasts sent yet.', 'send')}
      </div></div>
    </div><div class="col-lg-4">
      <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Channels</h2></div><div class="list-group list-group-flush">
        ${listItem('envelope', 'info', 'Email', `${totals().totalMembers} recipients`, '<span class="badge bg-success-subtle text-success-emphasis">Connected</span>')}
        ${listItem('chat-dots', 'warning', 'SMS', 'Sender ID: MLAZ', '<span class="badge bg-success-subtle text-success-emphasis">Connected</span>')}
        ${listItem('window', 'primary', 'Portal & website', 'Announcement feed', '<span class="badge bg-success-subtle text-success-emphasis">Connected</span>')}
      </div></div>
      <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Resource library</h2></div><div class="list-group list-group-flush">
        ${[['BoZ & MoF circulars', 9], ['Templates & forms', 8], ['MLAZ constitution & code of conduct', 3], ['Training materials', 4]].map(([n, c]) => listItem('folder2', 'secondary', n, `${c} documents`)).join('')}
      </div></div>
    </div></div>`;
}
function removeAnnouncement(i) { S.announce.splice(i, 1); commit(); toast('Announcement removed'); rerender(); }
function broadcast(preset) {
  const t = totals(), dues = preset === 'dues';
  confirmModal({
    title: 'New broadcast', confirmText: `${icon('send', 'me-1')} Send`,
    body: `<div class="row g-3">
      <div class="col-md-6"><label class="form-label small fw-medium">Audience</label><select class="form-select" name="audience"><option>All members (${t.totalMembers})</option><option ${dues ? 'selected' : ''}>Dues outstanding (${t.outstanding})</option><option>Gold tier (${t.tiers.Gold})</option><option>Silver tier (${t.tiers.Silver})</option><option>Bronze tier (${t.tiers.Bronze})</option></select></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Channels</label><select class="form-select" name="channels"><option>Email, SMS & portal</option><option>Email only</option><option>SMS only</option><option>Portal only</option></select></div>
      <div class="col-12"><label class="form-label small fw-medium">Subject</label><input class="form-control" name="subject" required value="${dues ? 'Reminder: membership dues outstanding' : `${new Date().getFullYear() + 1} membership renewals now open`}"></div>
      <div class="col-12"><label class="form-label small fw-medium">Message</label><textarea class="form-control" name="body" rows="4" required>${dues ? 'Dear member, our records show your annual dues are outstanding. Pay online in the member portal to keep your accreditation active.' : 'Dear member, renew before 31 December to keep your accreditation active and your listing in the public directory.'}</textarea></div></div>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      S.broadcasts.unshift({ subject: v.subject, audience: v.audience, channels: v.channels, date: fmtDate(new Date()) });
      if (/portal/i.test(v.channels)) S.announce.unshift({ title: v.subject, date: today(), tag: dues ? 'Dues' : 'Notice', body: v.body });
      commit(); toast(`Broadcast sent to ${v.audience}`); rerender();
    },
  }).querySelector('.modal-dialog').classList.add('modal-lg');
}

/* ================= EVENTS ================= */
function events() {
  return pageHeader('Events', 'AGMs, trainings and webinars for members', `<button class="btn btn-primary" onclick="newEvent()">${icon('plus-lg', 'me-1')} New event</button>`)
    + `<div class="row g-3">${S.events.map((e, i) => { const pct = Math.min(100, Math.round(e.reg / e.cap * 100)); return `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
      <div class="d-flex justify-content-between mb-2"><span class="badge bg-info-subtle text-info-emphasis">${esc(e.type)}</span><span class="small text-body-secondary">${fmtDate(e.date)}</span></div>
      <h2 class="h6 fw-semibold mb-1">${esc(e.name)}</h2><div class="small text-body-secondary mb-3">${icon('geo-alt', 'me-1')}${esc(e.town)}</div>
      <div class="mt-auto"><div class="d-flex justify-content-between small mb-1"><span>${e.reg} / ${e.cap} registered</span><span class="text-body-secondary">${pct}%</span></div>
      <div class="progress mb-3" style="height:6px"><div class="progress-bar" style="width:${pct}%"></div></div>
      <button class="btn btn-outline-secondary btn-sm w-100" onclick="manageEvent(${i})">Manage</button></div>
    </div></div></div>`; }).join('') || `<div class="col-12">${empty('No upcoming events.', 'calendar')}</div>`}</div>`;
}
function newEvent() {
  confirmModal({
    title: 'New event', confirmText: 'Create event',
    body: `<div class="row g-3"><div class="col-12"><label class="form-label small fw-medium">Event name</label><input class="form-control" name="name" required></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Date</label><input class="form-control" type="date" name="date" required></div>
      <div class="col-md-6"><label class="form-label small fw-medium">Type</label><select class="form-select" name="type"><option>Training</option><option>Webinar</option><option>AGM</option><option>Networking</option></select></div>
      <div class="col-md-8"><label class="form-label small fw-medium">Venue</label><input class="form-control" name="town" required></div>
      <div class="col-md-4"><label class="form-label small fw-medium">Capacity</label><input class="form-control" type="number" name="cap" min="1" value="100" required></div></div>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      S.events.push({ name: v.name, date: v.date, town: v.town, type: v.type, reg: 0, cap: Math.max(1, +v.cap) });
      S.events.sort((a, b) => a.date.localeCompare(b.date)); commit(); toast('Event published to members'); rerender();
    },
  });
}
function manageEvent(i) {
  const e = S.events[i];
  const attendees = S.registered.filter(r => r.event === e.name);
  const el = modal({
    title: esc(e.name),
    body: `<div class="small mb-3"><div class="d-flex justify-content-between py-2 border-bottom"><span class="text-body-secondary">Date</span><b>${fmtDate(e.date)}</b></div><div class="d-flex justify-content-between py-2 border-bottom"><span class="text-body-secondary">Venue</span><b>${esc(e.town)}</b></div><div class="d-flex justify-content-between py-2"><span class="text-body-secondary">Registrations</span><b>${e.reg} / ${e.cap}</b></div></div>
      <div class="small fw-semibold mb-2">Registered via the portal</div><div class="list-group">${attendees.map(r => `<div class="list-group-item small">${esc(memberById(r.member)?.name || r.member)}</div>`).join('') || '<div class="list-group-item small text-body-secondary">No portal registrations yet.</div>'}</div>`,
    footer: `<button class="btn btn-outline-danger me-auto" data-cancel>Cancel event</button><button class="btn btn-light" data-bs-dismiss="modal">Close</button>`,
  });
  el.querySelector('[data-cancel]').onclick = () => { el.close(); setTimeout(() => confirmModal({ title: 'Cancel event', body: `Cancel <b>${esc(e.name)}</b>? Registered members will be notified.`, confirmText: 'Cancel event', tone: 'danger', onConfirm: () => { S.events.splice(i, 1); commit(); toast('Event cancelled'); rerender(); } }), 300); };
}

/* ================= DIRECTORY & SETTINGS ================= */
function directory() {
  return pageHeader('Public directory', 'What borrowers and regulators see when they verify a member', `<a class="btn btn-outline-secondary" href="#/directory" target="_blank">${icon('box-arrow-up-right', 'me-1')} Open public directory</a>`)
    + `<div class="alert alert-light border small d-flex gap-2">${icon('info-circle', 'text-primary')}<div>Only <b>active, accredited</b> members in good standing are listed publicly and pass verification. Listing updates automatically.</div></div>`
    + tableCard(['Member', 'Member no.', 'Town', 'Tier', 'Public listing'], S.members.map(m => `<tr class="clickable" onclick="nav('app/members/${m.id}')"><td class="fw-medium">${esc(m.name)}</td><td class="small font-monospace">${m.id}</td><td>${esc(m.town)}</td><td>${tierBadge(m.tier)}</td>
      <td>${inGoodStanding(m) ? '<span class="badge bg-success-subtle text-success-emphasis">Listed</span>' : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Hidden</span>'}</td></tr>`).join(''));
}
function settings() {
  const row = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><b>${v}</b></div>`;
  return pageHeader('Settings', 'Tiers, fees, certificate template, roles and integrations')
    + `<div class="row g-3">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Membership tiers & fees</h2></div><div class="card-body">
        ${row('Gold — annual dues', K(TIERDUES.Gold))}${row('Silver — annual dues', K(TIERDUES.Silver))}${row('Bronze — annual dues', K(TIERDUES.Bronze))}${row('Joining fee', K(JOINING_FEE))}${row('Renewal cycle', 'Annual (calendar year)')}</div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Roles</h2></div><div class="list-group list-group-flush">
        ${[['Secretariat Admin', 'Full access'], ['Membership Officer', 'Applications, members, certificates'], ['Finance Officer', 'Payments, dues, reconciliation'], ['Communications Officer', 'Announcements, events'], ['Member', 'Own profile, dues, documents']].map(r => listItem('person', 'primary', r[0], r[1])).join('')}</div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Certificate template</h2></div><div class="card-body small text-body-secondary">MLAZ-branded accreditation with serial number, QR verification and 12-month validity. Generated automatically once the MoF authorization is verified and fees are paid.</div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Integrations</h2></div><div class="list-group list-group-flush">
        ${[['phone', 'Mobile money (MTN, Airtel, Zamtel)', 1], ['credit-card', 'Card & bank payments', 1], ['envelope', 'Email & SMS gateway', 1], ['link-45deg', 'iZyane Credit Bureau (SSO)', 0]].map(([ic, n, on]) => listItem(ic, 'info', n, '', on ? '<span class="badge bg-success-subtle text-success-emphasis">Connected</span>' : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Available add-on</span>')).join('')}</div></div></div>
      <div class="col-12"><div class="card"><div class="card-body d-flex flex-wrap align-items-center gap-3"><div class="me-auto"><h2 class="h6 mb-1">Demo data</h2><div class="small text-body-secondary">This prototype stores changes in your browser. Reset to restore the original sample data.</div></div><button class="btn btn-outline-danger" onclick="resetDemo()">Reset demo data</button></div></div></div>
    </div>`;
}

/* ================= SEARCH ================= */
export function adminSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return '';
  const hits = [
    ...S.members.filter(m => (m.name + m.id + m.town).toLowerCase().includes(q)).map(m => `<a class="dropdown-item py-2" href="#/app/members/${m.id}">${icon('person', 'me-2 text-body-secondary')}${esc(m.name)} <span class="small text-body-secondary">${m.id}</span></a>`),
    ...S.apps.filter(a => (a.name + a.id + a.town).toLowerCase().includes(q)).map(a => `<a class="dropdown-item py-2" href="#/app/applications/${a.id}">${icon('file-earmark-text', 'me-2 text-body-secondary')}${esc(a.name)} <span class="small text-body-secondary">${a.id}</span></a>`),
  ];
  return hits.slice(0, 8).join('') || '<span class="dropdown-item-text small text-body-secondary">No matches</span>';
}

export const ADMIN_NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'grid-1x2']]],
  ['Membership', [['members', 'Members', 'people'], ['applications', 'Applications', 'file-earmark-text', () => counts().open], ['certificates', 'Certificates', 'award', () => counts().mofReview + counts().ready]]],
  ['Finance', [['payments', 'Payments & dues', 'credit-card']]],
  ['Engage', [['communications', 'Communications', 'megaphone'], ['events', 'Events', 'calendar-event'], ['directory', 'Public directory', 'globe']]],
  ['Configure', [['settings', 'Settings', 'gear']]],
];
export const ADMIN_PAGES = { dashboard, members, applications, certificates, payments, communications, events, directory, settings };
expose({ exportMembers, setMFilter, sendReminder, setStatus, recordDues, verifyRenewal, viewMof, verifyMof, rejectMof, recordAppPayment, issueAccreditation, reconcile, retryPayment, removeAnnouncement, broadcast, newEvent, manageEvent });

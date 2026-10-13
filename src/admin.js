import {
  S, commit, nextId, esc, K, KM, fmtDate, today, plusYear, TIERDUES, JOINING_FEE, totals, counts, memberById, appById, inGoodStanding,
  certNo, log, addPayment, icon, avatar, statusBadge, tierBadge, accredBadge, mofBadge, duesBadge, appBadge, payBadge, pageHeader,
  statCard, stepper, empty, listItem, toast, modal, confirmModal, readForm, viewCert, nav, rerender, expose, getDoc, deleteDoc,
  fmtDateTime, audit, accredit, currentStaff, printDoc, confirmPayment, remote,
} from './ui.js';

const crumb = (href, label, current) => `<li class="breadcrumb-item"><a href="#/app/${href}">${label}</a></li><li class="breadcrumb-item active">${esc(current)}</li>`;
const tableCard = (head, rows, emptyText) => `<div class="card"><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr>${head.map(h => `<th class="${h.startsWith('#') ? 'text-end' : ''}">${h.replace('#', '')}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}">${empty(emptyText)}</td></tr>`}</tbody></table></div></div>`;

/* ================= DASHBOARD ================= */
function dashboard() {
  const t = totals(), c = counts();
  const lapsed = S.members.filter(m => m.status !== 'active');
  const open = S.apps.filter(a => a.stage !== 'accredited');
  const me = currentStaff()?.email;
  const attention = [
    ...S.apps.filter(a => a.stage === 'mof_review' && !a.recommendation).map(a => listItem('file-earmark-check', 'warning', 'MoF authorization to verify', `${esc(a.name)} · ${esc(a.mofRef)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${a.id}">Review</a>`)),
    ...S.apps.filter(a => a.stage === 'mof_review' && a.recommendation && a.recommendation.email !== me).map(a => listItem('person-check', 'primary', 'Recommendation awaiting your approval', `${esc(a.name)} · recommended by ${esc(a.recommendation.by)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${a.id}">Review</a>`)),
    ...S.members.filter(m => m.mofRenewalPending).map(m => listItem('file-earmark-check', 'warning', 'MoF renewal to verify', `${esc(m.name)} · ${esc(m.mofRenewalRef)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/members/${m.id}">Review</a>`)),
    ...S.payments.filter(p => p.status === 'pending' && p.popKey).filter((p, i, all) => all.findIndex(x => x.popKey === p.popKey) === i).map(p => listItem('bank', 'info', 'Bank transfer to confirm', `${esc(p.member)} · ref ${esc(p.bankRef)}`, `<button class="btn btn-sm btn-outline-secondary" onclick="reviewPayment('${p.ref}')">Review</button>`)),
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
      <div class="col-sm-6 col-xl-3">${statCard('Awaiting payment', c.awaitingPayment, 'certificate issues on payment', 'credit-card', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Lapsed / suspended', lapsed.length, 'need follow-up', 'exclamation-octagon', 'danger')}</div>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-xl-6"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Membership growth</h2><span class="ms-auto small text-body-secondary">Last 6 months</span></div><div class="card-body">${growthChart(t.totalMembers)}</div></div></div>
      <div class="col-md-6 col-xl-3"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Members by tier</h2></div><div class="card-body">${tierBars(t)}</div></div></div>
      <div class="col-md-6 col-xl-3"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Members by region</h2></div><div class="card-body">${regionBars(t)}</div></div></div>
    </div>
    <div class="row g-3">
      <div class="col-lg-7"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Onboarding pipeline</h2><a class="ms-auto small" href="#/app/applications">View all</a></div>
        ${open.length ? `<div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Applicant</th><th>Town</th><th>Stage</th><th>Submitted</th></tr></thead><tbody>
        ${open.map(a => `<tr class="clickable" onclick="nav('app/applications/${a.id}')"><td class="fw-medium">${esc(a.name)}</td><td>${esc(a.town)}</td><td>${appBadge(a)}</td><td class="small text-body-secondary">${esc(a.submitted)}</td></tr>`).join('')}</tbody></table></div>` : empty('No open applications.')}
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
function regionBars(t) {
  const sorted = Object.entries(t.regions).sort((x, y) => y[1] - x[1]);
  const rows = [...sorted.slice(0, 6), ['Other provinces', sorted.slice(6).reduce((n, [, v]) => n + v, 0)]], max = sorted[0][1];
  return rows.map(([k, n]) => `<div class="mb-2"><div class="d-flex justify-content-between small mb-1"><span class="fw-medium">${esc(k)}</span><span class="text-body-secondary">${n}</span></div>
    <div class="progress" style="height:6px"><div class="progress-bar" style="width:${n / max * 100}%;background:#0b5e3b"></div></div></div>`).join('');
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
        ${auditCard(m.id)}
      </div>
    </div>`;
}
function sendReminder(id) { const m = memberById(id); log(id, 'envelope', 'info', 'Reminder sent', `Email and SMS to ${m.contact} · ${fmtDate(new Date())}`); commit(); toast(`Reminder sent to ${m.name}`); rerender(); }
function setStatus(id, status) {
  const m = memberById(id);
  if (status === 'active') {
    if (m.mof !== 'valid') return toast('MoF authorization must be valid before reinstating', 'error');
    m.status = 'active'; m.accred = 'issued';
    log(id, 'arrow-counterclockwise', 'success', 'Membership reinstated', fmtDate(new Date())); audit(id, 'Membership reinstated'); commit(); toast(`${m.name} reinstated`); return rerender();
  }
  confirmModal({
    title: 'Suspend member', confirmText: 'Suspend', tone: 'danger',
    body: `<p>Suspending <b>${esc(m.name)}</b> revokes their accreditation and removes them from the public directory.</p><label class="form-label small fw-medium">Reason</label><textarea class="form-control" name="reason" rows="2" required>Non-compliance with the MLAZ code of conduct</textarea>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      m.status = 'suspended'; m.accred = 'revoked';
      log(id, 'slash-circle', 'danger', 'Membership suspended', v.reason); audit(id, 'Membership suspended', v.reason); commit(); toast(`${m.name} suspended`); rerender();
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
      const ref = addPayment(m.name, `Annual dues (${m.tier})`, TIERDUES[m.tier], v.method);
      m.duesPaid = true; audit(id, 'Offline dues payment recorded', `${K(TIERDUES[m.tier])} · ${v.method} · ${v.ref} · ${ref}`);
      if (m.status === 'lapsed' && m.mof === 'valid') { m.status = 'active'; m.accred = 'issued'; m.expiry = plusYear(); }
      log(id, 'credit-card', 'warning', 'Annual dues paid', `${K(TIERDUES[m.tier])} · ${v.method} · ${v.ref}`); commit(); toast('Payment recorded'); rerender();
    },
  });
}
function verifyRenewal(id) {
  const m = memberById(id);
  Object.assign(m, { mofRenewalPending: false, mof: 'valid', mofRef: m.mofRenewalRef || m.mofRef, expiry: plusYear() });
  if (m.status === 'suspended' && m.duesPaid) { m.status = 'active'; m.accred = 'issued'; }
  log(id, 'file-earmark-check', 'info', 'MoF renewal verified', `Valid until ${fmtDate(m.expiry)}`); audit(id, 'MoF renewal verified', `${m.mofRef} · valid until ${fmtDate(m.expiry)}`); commit(); toast('MoF renewal verified'); rerender();
}

/* ================= APPLICATIONS ================= */
const JOURNEY = ['Submitted', 'MoF authorization', 'Verification', 'Payment', 'Accredited'];
const STAGE_IDX = { details: 1, mof_review: 2, payment_pending: 3, accredited: 5 };
const DOCS = { mof: 'MoF money-lending authorization', pacra: 'PACRA certificate of incorporation', nrc: 'Director’s NRC' };
const docFile = (a, kind) => a[`${kind}File`] || (kind === 'mof' && a.mofRef && a.mofRef !== '—' ? 'Uploaded document' : '');
function applications(id) {
  if (id) return appDetail(id);
  return pageHeader('Applications', 'Self-onboarded lenders progressing to accredited membership', `<a class="btn btn-primary" href="#/apply">${icon('plus-lg', 'me-1')} New application</a>`)
    + `<div class="alert alert-light border d-flex gap-2 small">${icon('info-circle', 'text-primary')}<div>The Ministry of Finance authorization is verified <b>first</b>: one officer recommends and a second approves. Only then can the applicant pay, and accreditation is issued automatically on payment.</div></div>`
    + tableCard(['Reference', 'Applicant', 'Town', 'Tier', 'MoF reference', 'Stage', 'Submitted'], S.apps.map(a => `<tr class="clickable" onclick="nav('app/applications/${a.id}')">
      <td class="small font-monospace">${a.id}</td><td><div class="fw-medium">${esc(a.name)}</div><div class="small text-body-secondary">${esc(a.contact)}</div></td><td>${esc(a.town)}</td><td>${tierBadge(a.tier)}</td>
      <td class="small">${esc(a.mofRef)}</td><td>${appBadge(a)}</td><td class="small text-body-secondary">${esc(a.submitted)}</td></tr>`).join(''), 'No applications yet.');
}

// Automated checks. The ZRA lookup is simulated here: a well-formed TPIN is treated as an active taxpayer.
function appChecks(a) {
  const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fields = [['tpin', 'TPIN'], ['pacra', 'PACRA no.'], ['name', 'business name'], ['email', 'email'], ['phone', 'phone']];
  const others = [
    ...S.members.filter(m => m.id !== a.memberId).map(m => ({ rec: m, label: `member ${m.id}, ${m.status}`, href: `members/${m.id}` })),
    ...S.apps.filter(x => x.id !== a.id && !x.memberId).map(x => ({ rec: x, label: `application ${x.id}`, href: `applications/${x.id}` })),
  ];
  const dupes = others.map(o => ({ ...o, hit: fields.filter(([k]) => a[k] && norm(o.rec[k]) === norm(a[k])).map(([, l]) => l) })).filter(o => o.hit.length);
  return { tpinOk: /^\d{10}$/.test(a.tpin || ''), dupes, missing: Object.keys(DOCS).filter(k => !docFile(a, k)) };
}
function checksCard(a) {
  const c = appChecks(a);
  const row = (ok, title, sub, bad = 'warning') => listItem(ok ? 'check-circle-fill' : 'exclamation-triangle-fill', ok ? 'success' : bad, title, sub);
  return `<div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Automated checks</h2></div><div class="list-group list-group-flush">
    ${row(c.tpinOk, c.tpinOk ? 'TPIN verified with ZRA' : 'TPIN could not be verified', c.tpinOk ? `${esc(a.tpin)} · active taxpayer` : `${esc(a.tpin || 'Not provided')} · not found on the ZRA register`, 'danger')}
    ${row(!c.dupes.length, c.dupes.length ? 'Possible duplicate' : 'No duplicates found', c.dupes.length
      ? c.dupes.map(d => `Same ${d.hit.join(', ')} as <a href="#/app/${d.href}">${esc(d.rec.name)}</a> (${esc(d.label)})`).join('<br>')
      : 'Checked against all members and applications by TPIN, PACRA no., name, email and phone', 'danger')}
    ${row(!c.missing.length, c.missing.length ? 'Documents incomplete' : 'All documents received', c.missing.length ? `Missing: ${c.missing.map(k => DOCS[k]).join(', ')}` : 'MoF authorization, PACRA certificate and director NRC')}
  </div></div>`;
}
function docsCard(a) {
  const detail = { mof: `Ref ${esc(a.mofRef)}${a.mofExpiry ? ` · expires ${fmtDate(a.mofExpiry)}` : ''}`, pacra: `PACRA ${esc(a.pacra)}`, nrc: `${esc(a.director || a.contact)} · NRC ${esc(a.directorNrc || '—')}` };
  return `<div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Documents</h2></div><div class="list-group list-group-flush">
    ${Object.entries(DOCS).map(([k, label]) => { const f = docFile(a, k); return listItem(k === 'nrc' ? 'person-vcard' : 'file-earmark-text', f ? 'info' : 'secondary', label, f ? `${esc(f)} · ${detail[k]}` : 'Not yet uploaded',
      f ? `<button class="btn btn-sm btn-outline-primary text-nowrap" onclick="viewDoc('${a.id}','${k}')">${icon('eye', 'me-1')} View</button>` : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Missing</span>'); }).join('')}
  </div></div>`;
}
export function auditCard(target) {
  const rows = (S.audit || []).filter(x => x.target === target);
  return `<div class="card mt-3"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Audit trail</h2><span class="ms-auto small text-body-secondary">Every decision, with user and time</span></div><div class="list-group list-group-flush">
    ${rows.map(x => listItem('clock-history', 'secondary', esc(x.action), `${esc(x.by)} · ${fmtDateTime(x.at)}${x.note ? ` · ${esc(x.note)}` : ''}`)).join('') || empty('No recorded activity yet.', 'clock-history')}
  </div></div>`;
}
function decision(a) {
  const fee = JOINING_FEE + TIERDUES[a.tier], rec = a.recommendation, me = currentStaff();
  const note = (tone, ic, html) => `<div class="alert alert-${tone} small d-flex gap-2">${icon(ic)}<div>${html}</div></div>`;
  if (a.stage === 'details') return (a.note ? note('danger', 'arrow-return-left', `Returned to applicant: ${esc(a.note)}`) : '')
    + note('warning', 'hourglass', `The applicant has not yet uploaded their MoF authorization. They can do so from <b>Track application</b> using reference <b>${a.id}</b>.`)
    + `<button class="btn btn-outline-secondary" onclick="toast('Reminder sent to ${esc(a.email || a.phone)}')">${icon('envelope', 'me-1')} Send reminder</button>`;
  if (a.stage === 'mof_review' && !rec) return note('info', 'search', '<b>Step 1 of 2 (maker).</b> Check the documents and the Ministry of Finance register, then recommend approval. A second officer must approve.')
    + `<div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-danger" onclick="rejectMof('${a.id}')">Return to applicant</button><button class="btn btn-primary" onclick="recommendApp('${a.id}')">${icon('person-check', 'me-1')} Recommend approval</button></div>`;
  if (a.stage === 'mof_review') {
    const by = note('light border', 'person-check', `Recommended by <b>${esc(rec.by)}</b> (${esc(rec.title)}) · ${fmtDateTime(rec.at)}${rec.note ? `<div class="mt-1 fst-italic">“${esc(rec.note)}”</div>` : ''}`);
    if (rec.email === me?.email) return by + note('warning', 'shield-lock', '<b>Maker-checker:</b> you made this recommendation, so a different officer must approve it. In this demo, use <b>Switch to…</b> in the user menu to play the checker.');
    return by + note('info', 'clipboard-check', '<b>Step 2 of 2 (checker).</b> Review the recommendation, the documents and the automated checks, then approve or decline.')
      + `<div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-danger" onclick="declineRecommendation('${a.id}')">Decline recommendation</button><button class="btn btn-primary" onclick="approveApp('${a.id}')">${icon('check-lg', 'me-1')} Approve</button></div>`;
  }
  if (a.stage === 'payment_pending' && a.paymentPending) return note('info', 'bank', `The applicant paid ${K(fee)} by bank transfer and uploaded proof of payment. Confirm it to issue the accreditation certificate automatically.`)
    + `<button class="btn btn-primary" onclick="reviewPayment('${a.paymentPending[0]}')">${icon('file-earmark-check', 'me-1')} Review proof of payment</button>`;
  if (a.stage === 'payment_pending') return note('warning', 'credit-card', `Approved. Awaiting ${K(fee)} from the applicant (joining fee ${K(JOINING_FEE)} + ${a.tier} dues ${K(TIERDUES[a.tier])}). The accreditation certificate is issued automatically as soon as payment is received.`)
    + `<div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-secondary" onclick="toast('Payment link sent by SMS and email')">${icon('send', 'me-1')} Resend payment link</button><button class="btn btn-outline-primary" onclick="recordAppPayment('${a.id}')">Record offline payment</button></div>`;
  return note('success', 'award', `Accredited as member <b>${a.memberId}</b>. The certificate was generated automatically on payment.`)
    + `<div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-secondary" onclick="viewCert('${a.memberId}')">${icon('award', 'me-1')} View certificate</button><a class="btn btn-primary" href="#/app/members/${a.memberId}">Open member record</a></div>`;
}
function appDetail(id) {
  const a = appById(id); if (!a) return empty('Application not found.');
  const info = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v || '—'}</span></div>`;
  return pageHeader(esc(a.name), `${a.id} · ${esc(a.town)} · submitted ${esc(a.submitted)}`, appBadge(a), crumb('applications', 'Applications', a.name))
    + `<div class="card mb-3"><div class="card-body py-4">${stepper(JOURNEY, STAGE_IDX[a.stage])}</div></div>
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="card mb-3"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Review and decision</h2></div><div class="card-body">${decision(a)}</div></div>
        ${docsCard(a)}
      </div>
      <div class="col-lg-5">
        ${checksCard(a)}
        <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Applicant details</h2></div><div class="card-body">
          ${info('Business name', esc(a.name))}${info('PACRA no.', esc(a.pacra))}${info('ZRA TPIN', esc(a.tpin))}${info('Location', esc([a.town, a.province].filter(Boolean).join(', ')))}${info('Contact', esc([a.contact, a.position].filter(Boolean).join(', ')))}${info('Director', esc([a.director, a.directorNrc].filter(Boolean).join(' · ')))}${info('Phone', esc(a.phone))}${info('Email', esc(a.email))}${info('Tier', tierBadge(a.tier))}
        </div></div>
      </div>
    </div>
    ${auditCard(a.id)}`;
}
// Placeholders for sample applications, which have file names but no stored file.
function docPlaceholder(a, kind) {
  const wrap = (head, body) => `<div class="border rounded p-4 bg-white small" style="font-family:Georgia,serif"><div class="text-center mb-4">${head}</div>${body}</div>`;
  if (kind === 'pacra') return wrap(`<div class="fw-bold">PATENTS AND COMPANIES REGISTRATION AGENCY</div><div class="text-body-secondary">The Companies Act, 2017</div>`,
    `<h3 class="h5 text-center mb-4">Certificate of Incorporation</h3><p>This is to certify that <b>${esc(a.name)}</b> is this day incorporated under the Companies Act, 2017 and that the company is limited.</p>
     <div class="d-flex flex-wrap gap-4 mt-4"><div><div class="text-body-secondary">Registration number</div><b>${esc(a.pacra)}</b></div><div><div class="text-body-secondary">Registered office</div><b>${esc(a.town)}</b></div></div>`);
  if (kind === 'nrc') return `<div class="border rounded-3 p-4 mx-auto bg-white small" style="max-width:460px"><div class="text-center fw-bold mb-3">REPUBLIC OF ZAMBIA · NATIONAL REGISTRATION CARD</div>
    <div class="d-flex gap-3"><div class="bg-body-secondary rounded d-flex align-items-center justify-content-center text-body-secondary" style="width:90px;height:110px">${icon('person', 'fs-1')}</div>
    <div><div class="text-body-secondary">Name</div><div class="fw-semibold mb-2">${esc(a.director || a.contact)}</div><div class="text-body-secondary">NRC no.</div><div class="fw-semibold font-monospace">${esc(a.directorNrc || '—')}</div></div></div></div>`;
  return wrap(`<div class="fw-bold">REPUBLIC OF ZAMBIA</div><div class="fw-bold">MINISTRY OF FINANCE AND NATIONAL PLANNING</div><div class="text-body-secondary">Money Lenders Act, Chapter 398 of the Laws of Zambia</div>`,
    `<h3 class="h5 text-center mb-4">Certificate of Authorization to Carry on Money-Lending Business</h3>
     <p>This is to certify that <b>${esc(a.name)}</b>${a.pacra ? ` (PACRA ${esc(a.pacra)})` : ''} of ${esc(a.town)} is authorized to carry on the business of money lending in accordance with the Money Lenders Act.</p>
     <div class="d-flex flex-wrap gap-4 mt-4"><div><div class="text-body-secondary">Reference</div><b>${esc(a.mofRef)}</b></div>${a.mofExpiry ? `<div><div class="text-body-secondary">Valid until</div><b>${fmtDate(a.mofExpiry)}</b></div>` : ''}</div>`);
}
async function viewDoc(id, kind) {
  const a = appById(id), file = await getDoc(`${id}:${kind}`);
  const url = file && URL.createObjectURL(file), name = docFile(a, kind) || file?.name || kind;
  const body = !file ? `<div class="alert alert-light border small d-flex gap-2">${icon('info-circle', 'text-primary')}<div>No file is stored for this sample application. Showing a placeholder of the document.</div></div>${docPlaceholder(a, kind)}`
    : file.type.startsWith('image/') ? `<img src="${url}" alt="${esc(DOCS[kind])}" class="img-fluid d-block mx-auto border rounded">`
    : `<iframe src="${url}" title="${esc(DOCS[kind])}" class="w-100 border rounded" style="height:70vh"></iframe>`;
  const el = modal({
    title: `${DOCS[kind]} · ${esc(a.name)}`, size: 'xl', body,
    footer: `${file ? `<a class="btn btn-light me-auto" href="${url}" download="${esc(name)}">${icon('download', 'me-1')} Download</a><a class="btn btn-light" href="${url}" target="_blank" rel="noopener">${icon('box-arrow-up-right', 'me-1')} Open in new tab</a>` : ''}
      <button class="btn btn-light" data-bs-dismiss="modal">Close</button>`,
  });
  if (url) el.addEventListener('hidden.bs.modal', () => URL.revokeObjectURL(url));
}
function recommendApp(id) {
  const a = appById(id), c = appChecks(a);
  const flags = [!c.tpinOk && 'TPIN not verified', c.dupes.length && 'possible duplicate', c.missing.length && 'documents incomplete'].filter(Boolean);
  confirmModal({
    title: 'Recommend for approval', confirmText: 'Send for approval',
    body: `${flags.length ? `<div class="alert alert-warning small d-flex gap-2">${icon('exclamation-triangle')}<div>Automated checks flagged: <b>${flags.join(', ')}</b>. Explain in your note why you still recommend approval.</div></div>` : ''}
      <p class="small text-body-secondary">A second officer must approve before the applicant is asked to pay.</p>
      <label class="form-label small fw-medium">Note for the approver</label><textarea class="form-control" name="note" rows="3" ${flags.length ? 'required' : ''}>${flags.length ? '' : 'Authorization confirmed on the Ministry of Finance register.'}</textarea>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      const st = currentStaff();
      a.recommendation = { by: st.name, title: st.title, email: st.email, at: new Date().toISOString(), note: v.note };
      audit(id, 'Recommended for approval', v.note); commit(); toast('Sent to a second officer for approval'); rerender();
    },
  });
}
function approveApp(id) {
  const a = appById(id), st = currentStaff(), fee = JOINING_FEE + TIERDUES[a.tier];
  if (a.recommendation?.email === st.email) return toast('A different officer must approve your own recommendation', 'error');
  confirmModal({
    title: 'Approve application', confirmText: 'Approve',
    body: `<p class="mb-0">Approve the MoF authorization for <b>${esc(a.name)}</b>, recommended by ${esc(a.recommendation.by)}? The applicant will be sent a payment link for ${K(fee)}.</p>`,
    onConfirm: () => {
      a.stage = 'payment_pending'; a.note = ''; a.approval = { by: st.name, at: new Date().toISOString() };
      audit(id, 'Approved (checker)', `Recommended by ${a.recommendation.by}`);
      audit(id, 'Payment link sent', `${K(fee)} by SMS and email to ${a.email || a.phone}`, 'System');
      commit(); toast('Approved. Payment link sent to applicant'); rerender();
    },
  });
}
function declineRecommendation(id) {
  const a = appById(id);
  confirmModal({
    title: 'Decline recommendation', confirmText: 'Decline', tone: 'danger',
    body: `<p class="small text-body-secondary">The application goes back to the maker for another review.</p><label class="form-label small fw-medium">Reason</label><textarea class="form-control" name="reason" rows="3" required></textarea>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      const by = a.recommendation.by; a.recommendation = null;
      audit(id, 'Recommendation declined (checker)', `${v.reason} · returned to ${by}`); commit(); toast('Recommendation declined'); rerender();
    },
  });
}
function rejectMof(id) {
  confirmModal({
    title: 'Return to applicant', confirmText: 'Return application', tone: 'danger',
    body: `<label class="form-label small fw-medium">Reason (sent to the applicant)</label><textarea class="form-control" name="reason" rows="3" required>Authorization reference not found on the Ministry of Finance register. Please upload a valid authorization.</textarea>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      Object.assign(appById(id), { stage: 'details', note: v.reason, mofRef: '—', mofFile: '', recommendation: null }); deleteDoc(`${id}:mof`);
      audit(id, 'Returned to applicant', v.reason); commit(); toast('Application returned to applicant'); rerender();
    },
  });
}
function recordAppPayment(id) {
  const a = appById(id);
  confirmModal({
    title: 'Record offline payment', confirmText: 'Record payment',
    body: `<p class="small text-body-secondary">Record ${K(JOINING_FEE + TIERDUES[a.tier])} received from ${esc(a.name)} outside the online checkout. The accreditation certificate is issued automatically.</p>
      <div class="row g-3"><div class="col-6"><label class="form-label small fw-medium">Method</label><select class="form-select" name="method"><option>Bank transfer</option><option>Cash</option></select></div>
      <div class="col-6"><label class="form-label small fw-medium">Reference</label><input class="form-control" name="ref" required></div></div>`,
    onConfirm: el => {
      const v = readForm(el); if (!v) return false;
      const refs = [addPayment(a.name, 'Joining fee', JOINING_FEE, v.method), addPayment(a.name, `Annual dues (${a.tier})`, TIERDUES[a.tier], v.method)];
      audit(id, 'Offline payment recorded', `${K(JOINING_FEE + TIERDUES[a.tier])} · ${v.method} · ${v.ref} · ${refs.join(', ')}`);
      const memberId = accredit(a); commit(); toast('Payment recorded. Accreditation issued automatically'); rerender();
      setTimeout(() => viewCert(memberId), 350);
    },
  });
}

/* ================= CERTIFICATES ================= */
function certificates() {
  const c = counts();
  const mof = S.apps.filter(a => a.stage === 'mof_review'), awaiting = S.apps.filter(a => a.stage === 'payment_pending');
  const renewals = S.members.filter(m => m.mofRenewalPending);
  const issued = S.members.filter(m => m.accred === 'issued').sort((x, y) => y.joined.localeCompare(x.joined));
  return pageHeader('Certificates', 'Verify Ministry of Finance authorizations, then issue MLAZ accreditation')
    + `<div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('MoF to verify', c.mofReview, 'new & renewals', 'file-earmark-check', 'warning')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Awaiting payment', c.awaitingPayment, 'certificate issues on payment', 'credit-card', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Accreditations issued', totals().accredited, 'currently valid', 'patch-check', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Expiring in 90 days', 74, 'renewal reminders scheduled', 'calendar-x', 'danger')}</div>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">1</span>MoF authorizations to verify</h2></div><div class="list-group list-group-flush">
        ${mof.map(a => listItem('file-earmark-text', 'warning', esc(a.name), `${esc(a.mofRef)} · ${a.recommendation ? 'recommended, awaiting approval' : 'new application'}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${a.id}">Review</a>`)).join('')}
        ${renewals.map(m => listItem('file-earmark-text', 'info', esc(m.name), `${esc(m.mofRenewalRef)} · renewal`, `<button class="btn btn-sm btn-primary" onclick="verifyRenewal('${m.id}')">Verify</button>`)).join('')}
        ${mof.length + renewals.length ? '' : empty('Nothing waiting for verification.', 'check2-circle')}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">2</span>Awaiting payment</h2></div><div class="list-group list-group-flush">
        <div class="list-group-item small text-body-secondary">${icon('lightning-charge', 'me-1 text-primary')}Certificates are issued automatically the moment payment is received.</div>
        ${awaiting.map(a => listItem('credit-card', 'success', esc(a.name), `MoF approved · ${K(JOINING_FEE + TIERDUES[a.tier])} due`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${a.id}">View</a>`)).join('') || empty('No applications awaiting payment.', 'check2-circle')}
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
      <td class="text-end">${p.status === 'pending' && p.popKey ? `<button class="btn btn-sm btn-outline-primary text-nowrap" onclick="reviewPayment('${p.ref}')">Review PoP</button>` : p.status === 'failed' && !p.popKey ? `<button class="btn btn-sm btn-outline-secondary" onclick="retryPayment('${p.ref}')">Retry</button>` : p.status === 'success' ? `<button class="btn btn-sm btn-light" title="Receipt" onclick="viewReceipt('${p.ref}')">${icon('receipt')}</button>` : ''}</td></tr>`).join(''), 'No payments yet.')
    + `</div><div class="col-xl-4"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Fee schedule</h2></div><div class="card-body small">
      ${['Gold', 'Silver', 'Bronze'].map(k => `<div class="d-flex justify-content-between py-2 border-bottom"><span>${k} <span class="text-body-secondary">(${t.tiers[k]} members)</span></span><b>${K(TIERDUES[k])} / yr</b></div>`).join('')}
      <div class="d-flex justify-content-between py-2"><span>Joining fee</span><b>${K(JOINING_FEE)} once</b></div>
      <div class="alert alert-light border mt-3 mb-0">${icon('phone', 'me-1 text-primary')} Members pay by MTN, Airtel or Zamtel mobile money, iZyane Pay QR, card or bank transfer. Receipts are issued automatically.</div>
    </div></div></div></div>`;
}
function reconcile() {
  const pend = S.payments.filter(p => p.status === 'pending'); pend.forEach(confirmPayment);
  if (pend.length) audit('Payments', 'Reconciled', `${pend.length} pending payment(s) matched to bank and gateway records`);
  commit(); toast(pend.length ? `Reconciled ${pend.length} pending payment(s)` : 'All payments are reconciled'); rerender();
}
// Bank transfers arrive with a proof of payment; Finance checks it against the bank statement before confirming.
async function reviewPayment(ref) {
  const p0 = S.payments.find(x => x.ref === ref), group = S.payments.filter(x => x.popKey && x.popKey === p0.popKey), total = group.reduce((n, x) => n + x.amt, 0);
  const file = await getDoc(p0.popKey), url = file && URL.createObjectURL(file);
  const row = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
  const doc = !file ? `<div class="border rounded p-4 text-center text-body-secondary small">${icon('file-earmark', 'fs-2 d-block mb-2')}${esc(p0.pop || 'No file stored for this payment')}</div>`
    : file.type.startsWith('image/') ? `<img src="${url}" alt="Proof of payment" class="img-fluid d-block mx-auto border rounded">`
    : `<iframe src="${url}" title="Proof of payment" class="w-100 border rounded" style="height:60vh"></iframe>`;
  const el = modal({
    title: `Proof of payment · ${esc(p0.member)}`, size: 'xl',
    body: `<div class="row g-3"><div class="col-lg-8">${doc}</div><div class="col-lg-4">
      ${row('Payer', esc(p0.member))}${group.map(x => row(esc(x.type), K(x.amt))).join('')}${row('Total', `<b>${K(total)}</b>`)}${row('Bank reference', esc(p0.bankRef))}${row('Submitted', esc(p0.date))}${row('Status', payBadge(p0.status))}
      <div class="alert alert-light border small mt-3 mb-0">${icon('info-circle', 'me-1 text-primary')}Check the amount and reference against the MLAZ bank statement before confirming.</div></div></div>`,
    footer: `${url ? `<a class="btn btn-light me-auto" href="${url}" download="${esc(p0.pop || 'proof-of-payment')}">${icon('download', 'me-1')} Download</a>` : ''}<button class="btn btn-light" data-bs-dismiss="modal">Close</button>
      ${p0.status === 'pending' ? `<button class="btn btn-outline-danger" data-reject>Reject</button><button class="btn btn-primary" data-confirm>${icon('check-lg', 'me-1')} Confirm payment</button>` : ''}`,
  });
  if (url) el.addEventListener('hidden.bs.modal', () => URL.revokeObjectURL(url));
  el.querySelector('[data-confirm]')?.addEventListener('click', () => {
    group.forEach(confirmPayment); audit(p0.app || p0.memberId || 'Payments', 'Bank transfer confirmed', `${K(total)} · ref ${p0.bankRef} · ${group.map(x => x.ref).join(', ')}`);
    commit(); el.close(); toast(p0.app ? 'Payment confirmed. Accreditation issued automatically' : 'Payment confirmed. Receipt sent'); rerender();
  });
  el.querySelector('[data-reject]')?.addEventListener('click', () => { el.close(); setTimeout(() => confirmModal({
    title: 'Reject proof of payment', confirmText: 'Reject', tone: 'danger',
    body: `<label class="form-label small fw-medium">Reason (sent to the payer)</label><textarea class="form-control" name="reason" rows="3" required>The transfer could not be found on the MLAZ bank statement. Please check the reference and try again.</textarea>`,
    onConfirm: m => {
      const v = readForm(m); if (!v) return false;
      group.forEach(x => { x.status = 'failed'; x.note = v.reason; });
      if (p0.app) appById(p0.app).paymentPending = null;
      if (p0.memberId) memberById(p0.memberId).duesPending = null;
      audit(p0.app || p0.memberId || 'Payments', 'Proof of payment rejected', `${v.reason} · ref ${p0.bankRef}`); commit(); toast('Proof of payment rejected'); rerender();
    },
  }), 350); });
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
      audit('Communications', 'Broadcast sent', `${v.subject} · ${v.audience} · ${v.channels}`);
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
      audit('Events', 'Event created', `${v.name} · ${fmtDate(v.date)}`);
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

/* ================= REPORTS ================= */
const daysTo = d => Math.round((new Date(d) - new Date()) / 864e5);
const REPORTS = [
  { key: 'register', icon: 'people', title: 'Member register & accreditation status', desc: 'Every member with tier, region, MoF and accreditation status, dues and validity.',
    data: () => ({ cols: ['Member no.', 'Name', 'Province', 'Town', 'Tier', 'Status', 'MoF', 'Accreditation', 'Dues', 'Valid until'],
      rows: S.members.map(m => [m.id, m.name, m.province || '', m.town, m.tier, m.status, m.mof, m.accred, m.duesPaid ? 'Paid' : 'Outstanding', fmtDate(m.expiry)]) }) },
  { key: 'dues', icon: 'cash-stack', title: 'Dues collection by channel', desc: 'Successful payments grouped by channel, with transaction counts and totals.',
    data: () => {
      const by = {}; S.payments.filter(p => p.status === 'success').forEach(p => { (by[p.method] ||= { n: 0, amt: 0 }); by[p.method].n++; by[p.method].amt += p.amt; });
      const rows = Object.entries(by).sort((x, y) => y[1].amt - x[1].amt).map(([k, v]) => [k, v.n, K(v.amt)]);
      const tot = Object.values(by).reduce((a, v) => ({ n: a.n + v.n, amt: a.amt + v.amt }), { n: 0, amt: 0 });
      return { cols: ['Channel', 'Transactions', 'Collected'], rows: [...rows, ['Total', tot.n, K(tot.amt)]] };
    } },
  { key: 'arrears', icon: 'hourglass-split', title: 'Arrears & renewal pipeline', desc: 'Members with dues outstanding, lapsed status or accreditation expiring within 90 days.',
    data: () => ({ cols: ['Member no.', 'Name', 'Tier', 'Status', 'Dues', 'Amount due', 'Valid until', 'Days to expiry'],
      rows: S.members.filter(m => !m.duesPaid || m.status !== 'active' || daysTo(m.expiry) <= 90).map(m => [m.id, m.name, m.tier, m.status, m.duesPaid ? 'Paid' : 'Outstanding', m.duesPaid ? K(0) : K(TIERDUES[m.tier]), fmtDate(m.expiry), daysTo(m.expiry)]) }) },
  { key: 'events', icon: 'calendar-event', title: 'Event attendance & training', desc: 'Registrations against capacity for AGMs, trainings and webinars.',
    data: () => ({ cols: ['Event', 'Type', 'Date', 'Venue', 'Registered', 'Capacity', 'Fill rate'],
      rows: S.events.map(e => [e.name, e.type, fmtDate(e.date), e.town, e.reg, e.cap, `${Math.round(e.reg / e.cap * 100)}%`]) }) },
  { key: 'comms', icon: 'megaphone', title: 'Communications sent', desc: 'Broadcasts sent by email, SMS and portal, with audience and delivery status.',
    data: () => ({ cols: ['Date', 'Subject', 'Audience', 'Channels', 'Status'], rows: S.broadcasts.map(b => [b.date, b.subject, b.audience, b.channels, 'Delivered']) }) },
  { key: 'audit', icon: 'clock-history', title: 'Audit trail of approvals & changes', desc: 'Every recorded decision and change, with user and time.',
    data: () => ({ cols: ['Date & time', 'User', 'Record', 'Action', 'Details'], rows: (S.audit || []).map(x => [fmtDateTime(x.at), x.by, x.target, x.action, x.note]) }) },
];
const reportTable = ({ cols, rows }) => `<div class="table-responsive"><table class="table table-sm table-hover align-middle small mb-0"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="text-center text-body-secondary py-4">No records.</td></tr>`}</tbody></table></div>`;
function reports() {
  return pageHeader('Reports', 'Standard reports with export to Excel and PDF')
    + `<div class="row g-3">${REPORTS.map(rp => `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
      <div class="d-flex gap-3 mb-2"><span class="icon-circle bg-primary-subtle text-primary-emphasis">${icon(rp.icon)}</span><div><h2 class="h6 fw-semibold mb-1">${rp.title}</h2><div class="small text-body-secondary">${rp.desc}</div></div></div>
      <div class="small text-body-secondary mt-auto pt-3 mb-2">${rp.data().rows.length} rows</div>
      <div class="d-flex gap-2"><button class="btn btn-sm btn-outline-secondary flex-grow-1" onclick="viewReport('${rp.key}')">${icon('eye', 'me-1')} View</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="exportReport('${rp.key}','csv')" title="Opens in Excel">${icon('file-earmark-spreadsheet', 'me-1')} Excel</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="exportReport('${rp.key}','pdf')">${icon('file-earmark-pdf', 'me-1')} PDF</button></div>
    </div></div></div>`).join('')}</div>`;
}
function viewReport(key) {
  const rp = REPORTS.find(x => x.key === key);
  modal({ title: rp.title, size: 'xl', body: reportTable(rp.data()),
    footer: `<button class="btn btn-light me-auto" data-bs-dismiss="modal">Close</button><button class="btn btn-outline-secondary" onclick="exportReport('${key}','csv')">${icon('file-earmark-spreadsheet', 'me-1')} Excel</button><button class="btn btn-primary" onclick="exportReport('${key}','pdf')">${icon('file-earmark-pdf', 'me-1')} PDF</button>` });
}
function exportReport(key, format) {
  const rp = REPORTS.find(x => x.key === key), d = rp.data(), st = currentStaff();
  if (format === 'pdf') return printDoc(`MLAZ · ${rp.title}`, `<div class="eyebrow">MONEY LENDERS ASSOCIATION OF ZAMBIA</div><h1 class="h4 mt-1">${rp.title}</h1>
    <p class="small text-body-secondary">Generated ${fmtDateTime(new Date())}${st ? ` by ${esc(st.name)}` : ''} · ${d.rows.length} rows</p>${reportTable(d)}`);
  // CSV with a byte-order mark so Excel opens it with the right encoding.
  const csv = [d.cols, ...d.rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `mlaz-${key}-${today()}.csv`; a.click();
  audit('Reports', 'Report exported', `${rp.title} · Excel`); commit(); toast(`${rp.title} exported`);
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
        ${[['Secretariat Admin', 'Full access · approves recommendations (checker)'], ['Membership Officer', 'Applications, members, certificates · recommends (maker)'], ['Finance Officer', 'Payments, dues, reconciliation'], ['Communications Officer', 'Announcements, events'], ['Member', 'Own profile, dues, documents']].map(r => listItem('person', 'primary', r[0], r[1])).join('')}</div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Certificate template</h2></div><div class="card-body small text-body-secondary">MLAZ-branded accreditation with serial number, QR verification and 12-month validity. Generated automatically once the MoF authorization is verified and fees are paid.</div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Integrations</h2></div><div class="list-group list-group-flush">
        ${[['phone', 'Mobile money (MTN, Airtel, Zamtel)', 1], ['qr-code', 'iZyane Pay QR', 1], ['credit-card', 'Card & bank payments', 1], ['search', 'ZRA TPIN lookup', 1], ['envelope', 'Email & SMS gateway', 1], ['link-45deg', 'iZyane Credit Bureau (SSO)', 0]].map(([ic, n, on]) => listItem(ic, 'info', n, '', on ? '<span class="badge bg-success-subtle text-success-emphasis">Connected</span>' : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Available add-on</span>')).join('')}</div></div></div>
      <div class="col-12"><div class="card"><div class="card-body d-flex flex-wrap align-items-center gap-3"><div class="me-auto"><h2 class="h6 mb-1">Demo data</h2><div class="small text-body-secondary">${remote ? 'Data is shared by everyone using the platform. Resetting deletes all records and documents and restores the original sample data for everyone.' : 'This prototype stores changes in your browser. Reset to restore the original sample data.'}</div></div><button class="btn btn-outline-danger" onclick="resetDemo()">Reset demo data</button></div></div></div>
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
  ['Overview', [['dashboard', 'Dashboard', 'grid-1x2'], ['reports', 'Reports', 'file-earmark-bar-graph']]],
  ['Membership', [['members', 'Members', 'people'], ['applications', 'Applications', 'file-earmark-text', () => counts().open], ['certificates', 'Certificates', 'award', () => counts().mofReview]]],
  ['Finance', [['payments', 'Payments & dues', 'credit-card']]],
  ['Engage', [['communications', 'Communications', 'megaphone'], ['events', 'Events', 'calendar-event'], ['directory', 'Public directory', 'globe']]],
  ['Configure', [['settings', 'Settings', 'gear']]],
];
export const ADMIN_PAGES = { dashboard, reports, members, applications, certificates, payments, communications, events, directory, settings };
expose({ exportMembers, setMFilter, sendReminder, setStatus, recordDues, verifyRenewal, viewDoc, recommendApp, approveApp, declineRecommendation, rejectMof, recordAppPayment, reconcile, retryPayment, removeAnnouncement, broadcast, newEvent, manageEvent, viewReport, exportReport, reviewPayment });

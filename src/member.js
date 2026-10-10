import {
  S, commit, esc, K, fmtDate, nextYear, TIERDUES, JOINING_FEE, memberById, certNo, log, addPayment, getSession, icon, statusBadge,
  accredBadge, mofBadge, duesBadge, pageHeader, statCard, empty, listItem, toast, readForm, viewCert, payFlow, payMethodSelect, rerender, expose,
} from './ui.js';

const me = () => memberById(getSession()?.memberId);

function overview() {
  const m = me(), nextEv = S.events[0];
  const isReg = e => S.registered.some(r => r.event === e.name && r.member === m.id);
  const alerts = [];
  if (m.status !== 'active') alerts.push(`<div class="alert alert-danger d-flex gap-2">${icon('exclamation-octagon')}<div>Your membership is <b>${m.status}</b>. ${m.mof !== 'valid' ? 'Upload a valid Ministry of Finance authorization to restore your accreditation.' : 'Settle outstanding dues to restore your accreditation.'}</div></div>`);
  if (!m.duesNext) alerts.push(`<div class="alert alert-warning d-flex align-items-center gap-2">${icon('info-circle')}<div class="me-auto">${nextYear()} annual dues of ${K(TIERDUES[m.tier])} are now payable.</div><a class="btn btn-sm btn-warning" href="#/app/dues">Pay now</a></div>`);
  return pageHeader(`Welcome, ${esc(m.contact)}`, `${esc(m.name)} · ${m.id}`)
    + alerts.join('')
    + `<div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('Membership', statusBadge(m.status), `${m.tier} tier`, 'person-check', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('MoF authorization', m.mofRenewalPending ? '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis">Renewal pending</span>' : mofBadge(m.mof), esc(m.mofRef), 'file-earmark-check', 'info')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Accreditation', accredBadge(m.accred), `Valid until ${fmtDate(m.expiry)}`, 'award', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard(`${nextYear()} dues`, duesBadge(m.duesNext), K(TIERDUES[m.tier]), 'cash-stack', 'warning')}</div>
    </div>
    <div class="row g-3">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Quick actions</h2></div><div class="list-group list-group-flush">
        ${listItem('award', 'success', 'Accreditation certificate', certNo(m), m.accred === 'issued' ? `<button class="btn btn-sm btn-outline-secondary" onclick="viewCert('${m.id}')">Download</button>` : '')}
        ${listItem('file-earmark-arrow-up', 'info', 'Renew MoF authorization', `Expires ${fmtDate(m.expiry)}`, '<a class="btn btn-sm btn-outline-secondary" href="#/app/certificates">Upload</a>')}
        ${listItem('credit-card', 'warning', 'Pay annual dues', m.duesNext ? 'Paid — thank you' : `${K(TIERDUES[m.tier])} due`, '<a class="btn btn-sm btn-outline-secondary" href="#/app/dues">Open</a>')}
        ${nextEv ? listItem('calendar-event', 'primary', esc(nextEv.name), `${fmtDate(nextEv.date)} · ${esc(nextEv.town)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/events">${isReg(nextEv) ? 'Registered' : 'Register'}</a>`) : ''}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Announcements</h2><a class="ms-auto small" href="#/app/announcements">View all</a></div><div class="list-group list-group-flush">
        ${S.announce.slice(0, 4).map(a => listItem('megaphone', 'primary', esc(a.title), fmtDate(a.date))).join('') || empty('No announcements.')}
      </div></div></div>
    </div>`;
}

function certificates() {
  const m = me();
  const row = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium">${v}</span></div>`;
  return pageHeader('Certificates', 'Your Ministry of Finance authorization and MLAZ accreditation')
    + `<div class="row g-3 mb-3">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">1</span>Ministry of Finance authorization</h2></div><div class="card-body">
        ${row('Reference', esc(m.mofRef))}${row('Status', mofBadge(m.mof))}${row('Expires', fmtDate(m.expiry))}
        ${m.mofRenewalPending ? `<div class="alert alert-info small d-flex gap-2 mt-3 mb-0">${icon('hourglass-split')}<div>Renewal <b>${esc(m.mofRenewalRef)}</b> uploaded and awaiting verification by the Secretariat.</div></div>`
        : `<form id="renewform" class="mt-3" novalidate onsubmit="event.preventDefault();uploadRenewal()"><h3 class="h6 mt-2">Upload a renewed authorization</h3>
          <div class="row g-2"><div class="col-md-6"><input class="form-control" name="ref" required placeholder="New reference, e.g. MoF/ML/2027/0001"><div class="invalid-feedback">Required.</div></div>
          <div class="col-md-6"><input class="form-control" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach the document.</div></div>
          <div class="col-12"><button class="btn btn-primary">${icon('upload', 'me-1')} Submit for verification</button></div></div></form>`}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">2</span>MLAZ accreditation</h2></div><div class="card-body d-flex flex-column">
        ${row('Certificate no.', certNo(m))}${row('Status', accredBadge(m.accred))}${row('Valid until', fmtDate(m.expiry))}
        <p class="small text-body-secondary mt-3">Issued after your MoF authorization was verified and dues paid. Anyone can verify it by scanning the QR code.</p>
        <button class="btn btn-primary mt-auto" ${m.accred === 'issued' ? '' : 'disabled'} onclick="viewCert('${m.id}')">${icon('download', 'me-1')} View & download certificate</button>
      </div></div></div>
    </div>
    <div class="alert alert-light border small d-flex gap-2">${icon('info-circle', 'text-primary')}<div>Your MoF authorization is verified <b>first</b>, then your MLAZ accreditation is issued. If your MoF authorization lapses, your accreditation is suspended until it is renewed.</div></div>`;
}
function uploadRenewal() {
  const v = readForm(document.getElementById('renewform')); if (!v) return;
  const m = me(); m.mofRenewalPending = true; m.mofRenewalRef = v.ref;
  log(m.id, 'file-earmark-arrow-up', 'info', 'MoF renewal uploaded', `${v.ref} · ${v.file}`);
  commit(); toast('Authorization submitted for verification'); rerender();
}

function dues() {
  const m = me(), amt = TIERDUES[m.tier];
  const hist = S.payments.filter(p => p.member === m.name && p.status === 'success');
  return pageHeader('Dues & payments', 'Pay your annual membership dues online')
    + `<div class="row g-3"><div class="col-lg-5"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">${nextYear()} annual dues</h2></div><div class="card-body">
      <div class="d-flex justify-content-between small py-2 border-bottom"><span class="text-body-secondary">${m.tier} tier</span><span>${K(amt)}</span></div>
      <div class="d-flex justify-content-between fw-semibold py-2 mb-3"><span>Balance due</span><span>${m.duesNext ? K(0) : K(amt)}</span></div>
      ${m.duesNext ? `<div class="alert alert-success small d-flex gap-2 mb-0">${icon('check-circle')}<div>${nextYear()} dues are paid. Your membership and accreditation remain active.</div></div>` : `
      <label class="form-label small fw-medium">Payment method</label>${payMethodSelect()}
      <label class="form-label small fw-medium mt-3">Mobile number / account</label><input class="form-control" id="payacct" value="${esc(m.phone)}">
      <button class="btn btn-primary w-100 mt-3" onclick="payDues()">Pay ${K(amt)}</button>
      <div class="small text-body-secondary text-center mt-2">${icon('lock', 'me-1')}Secured payment · receipt emailed automatically</div>`}
    </div></div></div>
    <div class="col-lg-7"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Payment history</h2></div>
      <div class="table-responsive"><table class="table align-middle mb-0"><thead><tr><th>Description</th><th>Method</th><th>Date</th><th class="text-end">Amount</th></tr></thead><tbody>
      ${hist.map(p => `<tr><td>${esc(p.type)}<div class="small text-body-secondary font-monospace">${p.ref}</div></td><td class="small">${esc(p.method)}</td><td class="small">${esc(p.date)}</td><td class="text-end fw-medium">${K(p.amt)}</td></tr>`).join('')}
      <tr><td>2025 annual dues</td><td class="small">Bank transfer</td><td class="small">28 Jan 2025</td><td class="text-end fw-medium">K4,200</td></tr>
      <tr><td>Joining fee</td><td class="small">Bank transfer</td><td class="small">${fmtDate(m.joined)}</td><td class="text-end fw-medium">${K(JOINING_FEE)}</td></tr>
      </tbody></table></div></div></div></div>`;
}
function payDues() {
  const m = me(), amt = TIERDUES[m.tier], account = document.getElementById('payacct').value.trim();
  if (!account) return toast('Enter a mobile number or account', 'error');
  payFlow({
    amount: amt, description: `${nextYear()} annual dues (${m.tier})`, method: document.getElementById('paymethod').value, account,
    onSuccess: method => {
      const ref = addPayment(m.name, `${nextYear()} annual dues (${m.tier})`, amt, method);
      m.duesNext = true; m.duesPaid = true; log(m.id, 'credit-card', 'warning', `${nextYear()} dues paid`, `${K(amt)} · ${method}`);
      commit(); setTimeout(rerender, 50); return ref;
    },
  });
}

function events() {
  const m = me();
  return pageHeader('Events', 'Register for MLAZ events')
    + `<div class="row g-3">${S.events.map((e, i) => {
      const reg = S.registered.some(r => r.event === e.name && r.member === m.id), full = e.reg >= e.cap;
      return `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
        <div class="d-flex justify-content-between mb-2"><span class="badge bg-info-subtle text-info-emphasis">${esc(e.type)}</span><span class="small text-body-secondary">${fmtDate(e.date)}</span></div>
        <h2 class="h6 fw-semibold mb-1">${esc(e.name)}</h2><div class="small text-body-secondary mb-3">${icon('geo-alt', 'me-1')}${esc(e.town)} · ${Math.max(0, e.cap - e.reg)} places left</div>
        <div class="mt-auto">${reg ? `<div class="d-flex gap-2"><span class="btn btn-sm btn-success-subtle text-success-emphasis bg-success-subtle flex-grow-1 disabled">${icon('check-lg', 'me-1')}Registered</span><button class="btn btn-sm btn-light" onclick="toggleReg(${i})">Cancel</button></div>`
          : `<button class="btn btn-sm btn-primary w-100" ${full ? 'disabled' : ''} onclick="toggleReg(${i})">${full ? 'Fully booked' : 'Register'}</button>`}</div>
      </div></div></div>`; }).join('') || `<div class="col-12">${empty('No upcoming events.', 'calendar')}</div>`}</div>`;
}
function toggleReg(i) {
  const m = me(), e = S.events[i], at = S.registered.findIndex(r => r.event === e.name && r.member === m.id);
  if (at >= 0) { S.registered.splice(at, 1); e.reg--; toast('Registration cancelled'); }
  else { if (e.reg >= e.cap) return; S.registered.push({ event: e.name, member: m.id }); e.reg++; toast('Registered. Confirmation sent to ' + m.email); }
  commit(); rerender();
}

function announcements() {
  return pageHeader('Announcements', 'Notices from the MLAZ Secretariat')
    + `<div class="d-grid gap-3">${S.announce.map(a => `<div class="card"><div class="card-body"><div class="d-flex gap-2 align-items-center small text-body-secondary mb-1"><span class="badge bg-secondary-subtle text-secondary-emphasis">${esc(a.tag)}</span>${fmtDate(a.date)}</div><h2 class="h6 fw-semibold mb-1">${esc(a.title)}</h2><p class="small text-body-secondary mb-0">${esc(a.body)}</p></div></div>`).join('') || empty('No announcements.')}</div>`;
}

function profile() {
  const m = me();
  const f = (name, label, type = 'text', disabled) => `<div class="col-md-6"><label class="form-label small fw-medium">${label}</label><input class="form-control" ${disabled ? 'disabled' : `name="${name}" required`} type="${type}" value="${esc(m[name])}"><div class="invalid-feedback">Required.</div></div>`;
  return pageHeader('Business profile', 'Keep your details current. Changes appear in the public directory.', '<button class="btn btn-primary" onclick="saveProfile()">Save changes</button>')
    + `<div class="card"><div class="card-body p-4"><form id="pform" class="row g-3" novalidate onsubmit="event.preventDefault();saveProfile()">
      ${f('name', 'Business name')}${f('id', 'Member number', 'text', true)}${f('town', 'Town')}${f('tier', 'Tier', 'text', true)}
      ${f('contact', 'Contact person')}${f('phone', 'Phone', 'tel')}${f('email', 'Email (used to sign in)', 'email')}
    </form></div></div>`;
}
function saveProfile() {
  const v = readForm(document.getElementById('pform')); if (!v) return toast('Please complete the required fields', 'error');
  const m = me(), oldName = m.name;
  Object.assign(m, v);
  if (oldName !== m.name) S.payments.forEach(p => { if (p.member === oldName) p.member = m.name; });
  log(m.id, 'pencil', 'secondary', 'Profile updated', fmtDate(new Date())); commit(); toast('Profile saved'); rerender();
}

export const MEMBER_NAV = [
  ['My membership', [['overview', 'Overview', 'grid-1x2'], ['certificates', 'Certificates', 'award'], ['dues', 'Dues & payments', 'credit-card', () => (me()?.duesNext ? 0 : 1)]]],
  ['Engage', [['events', 'Events', 'calendar-event'], ['announcements', 'Announcements', 'megaphone'], ['profile', 'Business profile', 'building']]],
];
export const MEMBER_PAGES = { overview, certificates, dues, events, announcements, profile };
export const currentMember = me;
expose({ uploadRenewal, payDues, toggleReg, saveProfile });

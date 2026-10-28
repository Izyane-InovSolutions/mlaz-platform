import {
  S, commit, esc, K, fmtDate, nextYear, TIERDUES, JOINING_FEE, memberById, certNo, log, getSession, icon, statusBadge,
  accredBadge, mofBadge, duesBadge, pageHeader, statCard, empty, listItem, toast, readForm, viewCert, payForm, takePayment, rerender, expose, audit,
  eventByName, ticketPrice, priceLabel, tix, confirmModal, modal, NRC_ATTRS,
} from './ui.js';
import { lookup, customersOf, isGood, GOOD_SCORE, SCORE_MIN, SCORE_MAX } from './bureau.js';

const me = () => memberById(getSession()?.memberId);

function overview() {
  const m = me(), nextEv = S.events[0];
  const isReg = e => myReg(e);
  const alerts = [];
  if (m.status !== 'active') alerts.push(`<div class="alert alert-danger d-flex gap-2">${icon('exclamation-octagon')}<div>Your membership is <b>${m.status}</b>. ${m.mof !== 'valid' ? 'Upload a valid Ministry of Finance authorization to restore your accreditation.' : 'Settle outstanding dues to restore your accreditation.'}</div></div>`);
  if (!m.duesNext) alerts.push(`<div class="alert alert-warning d-flex align-items-center gap-2">${icon('info-circle')}<div class="me-auto">${nextYear()} annual dues of ${K(TIERDUES[m.tier])} are now payable.</div><a class="btn btn-sm btn-warning" href="#/app/dues">Pay now</a></div>`);
  return `<div class="card band-dark border-0 shadow-sm mb-4"><div class="card-body p-4">
      <h1 class="h4 mb-1">${esc(m.name)}</h1>
      <div class="small opacity-75">Member ID ${m.id}</div>
    </div></div>`
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
        ${nextEv ? listItem('calendar-event', 'primary', esc(nextEv.name), `${fmtDate(nextEv.date)} · ${esc(nextEv.town)}`, `<a class="btn btn-sm btn-outline-secondary" href="${eventHref(nextEv)}">${isReg(nextEv) ? 'Registered' : 'Register'}</a>`) : ''}
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
  audit(m.id, 'MoF renewal uploaded', v.ref, `${m.contact} (member)`);
  commit(); toast('Authorization submitted for verification'); rerender();
}

function dues() {
  const m = me(), amt = TIERDUES[m.tier];
  const hist = S.payments.filter(p => p.member === m.name && p.status === 'success');
  return pageHeader('Dues & payments', 'Pay your annual membership dues online')
    + `<div class="row g-3"><div class="col-lg-5"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">${nextYear()} annual dues</h2></div><div class="card-body">
      <div class="d-flex justify-content-between small py-2 border-bottom"><span class="text-body-secondary">${m.tier} tier</span><span>${K(amt)}</span></div>
      <div class="d-flex justify-content-between fw-semibold py-2 mb-3"><span>Balance due</span><span>${m.duesNext ? K(0) : K(amt)}</span></div>
      ${m.duesNext ? `<div class="alert alert-success small d-flex gap-2 mb-0">${icon('check-circle')}<div>${nextYear()} dues are paid. Your membership and accreditation remain active.</div></div>`
      : m.duesPending ? `<div class="alert alert-info small d-flex gap-2 mb-0">${icon('hourglass-split')}<div>Your bank transfer for ${K(amt)} is awaiting confirmation by MLAZ Finance, usually within 1 working day. Your receipt is issued once it’s confirmed.</div></div>` : `
      ${payForm('duespay', { phone: m.phone, reference: m.id })}
      <button class="btn btn-primary w-100 mt-3" onclick="payDues()">Pay ${K(amt)}</button>
      <div class="small text-body-secondary text-center mt-2">${icon('lock', 'me-1')}Secured payment · receipt emailed automatically</div>`}
    </div></div></div>
    <div class="col-lg-7"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Payment history</h2></div>
      <div class="table-responsive"><table class="table align-middle mb-0"><thead><tr><th>Description</th><th>Method</th><th>Date</th><th class="text-end">Amount</th><th></th></tr></thead><tbody>
      ${hist.map(p => `<tr><td>${esc(p.type)}<div class="small text-body-secondary font-monospace">${p.ref}</div></td><td class="small">${esc(p.method)}</td><td class="small">${esc(p.date)}</td><td class="text-end fw-medium">${K(p.amt)}</td><td class="text-end"><button class="btn btn-sm btn-light" title="Receipt" onclick="viewReceipt('${p.ref}')">${icon('receipt')}</button></td></tr>`).join('')}
      <tr><td>2025 annual dues</td><td class="small">Bank transfer</td><td class="small">28 Jan 2025</td><td class="text-end fw-medium">K4,200</td><td></td></tr>
      <tr><td>Joining fee</td><td class="small">Bank transfer</td><td class="small">${fmtDate(m.joined)}</td><td class="text-end fw-medium">${K(JOINING_FEE)}</td><td></td></tr>
      </tbody></table></div></div></div></div>`;
}
function payDues() {
  const m = me(), amt = TIERDUES[m.tier];
  takePayment('duespay', {
    payer: m.name, description: `${nextYear()} annual dues (${m.tier})`, link: { memberId: m.id, dues: nextYear() },
    items: [{ type: `${nextYear()} annual dues (${m.tier})`, amt }],
    onDone: ({ refs, pending, method, detail }) => {
      if (pending) { m.duesPending = refs[0]; audit(m.id, 'Proof of payment submitted', `${K(amt)} · bank transfer · ref ${detail}`, `${m.contact} (member)`); }
      else {
        m.duesNext = true; m.duesPaid = true; log(m.id, 'credit-card', 'warning', `${nextYear()} dues paid`, `${K(amt)} · ${method}`);
        audit(m.id, 'Dues paid online', `${K(amt)} · ${method} · ${refs[0]}`, `${m.contact} (member)`);
      }
      setTimeout(rerender, 50);
    },
  });
}

const MAX_TICKETS = 10;
const myReg = e => S.registered.find(r => r.event === e.name && r.member === me().id);
const eventHref = e => `#/app/events/${encodeURIComponent(e.name)}`;

function events(name) {
  if (name) return eventPage(name);
  return pageHeader('Events', 'Register for MLAZ events')
    + `<div class="row g-3">${S.events.map(e => {
      const r = myReg(e), full = e.reg >= e.cap;
      return `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
        <div class="d-flex justify-content-between mb-2"><span class="badge bg-info-subtle text-info-emphasis">${esc(e.type)}</span><span class="small text-body-secondary">${fmtDate(e.date)}</span></div>
        <h2 class="h6 fw-semibold mb-1">${esc(e.name)}</h2><div class="small text-body-secondary mb-2">${icon('geo-alt', 'me-1')}${esc(e.town)} · ${Math.max(0, e.cap - e.reg)} places left</div>
        <div class="small fw-semibold mb-3">${icon('ticket-perforated', 'me-1 text-primary')}${priceLabel(e)}</div>
        <div class="mt-auto">${r ? `<a class="btn btn-sm w-100 ${r.status === 'pending' ? 'btn-outline-info' : 'btn-outline-success'}" href="${eventHref(e)}">${r.status === 'pending' ? `${icon('hourglass-split', 'me-1')}Payment pending` : `${icon('check-lg', 'me-1')}Registered · ${tix(r.tickets || 1)}`}</a>`
          : `<a class="btn btn-sm btn-primary w-100 ${full ? 'disabled' : ''}" href="${eventHref(e)}">${full ? 'Fully booked' : 'Register'}</a>`}</div>
      </div></div></div>`; }).join('') || `<div class="col-12">${empty('No upcoming events.', 'calendar')}</div>`}</div>`;
}
function eventPage(name) {
  const m = me(), e = eventByName(name), crumbs = `<li class="breadcrumb-item"><a href="#/app/events">Events</a></li><li class="breadcrumb-item active">${esc(name)}</li>`;
  if (!e) return pageHeader('Event not found', '', '', crumbs) + empty('This event is no longer available.', 'calendar-x');
  const i = S.events.indexOf(e), price = ticketPrice(e), left = Math.max(0, e.cap - e.reg), max = Math.min(left, MAX_TICKETS), r = myReg(e);
  const row = (k, v) => `<div class="d-flex justify-content-between gap-2 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
  let panel;
  if (r) {
    panel = `<div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Your registration</h2></div><div class="card-body">
      ${row('Tickets', tix(r.tickets || 1))}${row('Amount', r.amt ? K(r.amt) : 'Free')}
      ${r.status === 'pending' ? `<div class="alert alert-info small d-flex gap-2 mt-3 mb-0">${icon('hourglass-split')}<div>Your bank transfer for ${K(r.amt)} is awaiting confirmation by MLAZ Finance, usually within 1 working day. Your places are held until then.</div></div>`
        : `<div class="alert alert-success small d-flex gap-2 mt-3">${icon('check-circle')}<div>You’re registered. Confirmation was sent to ${esc(m.email)}.</div></div>
        <div class="d-flex gap-2">${r.refs?.length ? `<button class="btn btn-outline-secondary flex-grow-1" onclick="viewReceipt('${r.refs[0]}')">${icon('receipt', 'me-1')} Receipt</button>` : ''}
        ${r.amt ? '' : `<button class="btn btn-light flex-grow-1" onclick="cancelReg(${i})">Cancel registration</button>`}</div>
        ${r.amt ? `<div class="small text-body-secondary mt-3">${icon('info-circle', 'me-1')}To change or cancel a paid registration, contact the Secretariat.</div>` : ''}`}
    </div>`;
  } else if (!left) {
    panel = `<div class="card-body">${empty('This event is fully booked.', 'calendar-x')}</div>`;
  } else {
    panel = `<div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Register</h2></div><div class="card-body">
      <label class="form-label small fw-medium" for="evqty">Number of tickets</label>
      <input class="form-control" type="number" id="evqty" min="1" max="${max}" value="1" required oninput="evQty(${price})">
      <div class="invalid-feedback">Choose between 1 and ${max}.</div>
      <div class="small text-body-secondary mt-1 mb-3">Up to ${tix(max)} per booking · ${left} places left</div>
      ${price ? `<div class="d-flex justify-content-between small py-2 border-bottom"><span class="text-body-secondary">${K(price)} × <span data-evn>1</span></span><span data-evtotal>${K(price)}</span></div>
      <div class="d-flex justify-content-between fw-semibold py-2 mb-3"><span>Total</span><span data-evtotal>${K(price)}</span></div>
      ${payForm('evpay', { phone: m.phone, reference: m.id })}
      <button class="btn btn-primary w-100 mt-3" onclick="registerEvent(${i})">Pay <span data-evtotal>${K(price)}</span></button>
      <div class="small text-body-secondary text-center mt-2">${icon('lock', 'me-1')}Secured payment · receipt emailed automatically</div>`
      : `<button class="btn btn-primary w-100" onclick="registerEvent(${i})">Register</button>`}
    </div>`;
  }
  return pageHeader(esc(e.name), `${esc(e.type)} · ${fmtDate(e.date)}`, '', crumbs)
    + `<div class="row g-3"><div class="col-lg-5"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Event details</h2></div><div class="card-body">
      ${row('Date', fmtDate(e.date))}${row('Venue', esc(e.town))}${row('Type', esc(e.type))}${row('Ticket price', price ? K(price) : 'Free')}${row('Places left', `${left} of ${e.cap}`)}
    </div></div></div><div class="col-lg-7"><div class="card">${panel}</div></div></div>`;
}
function evQty(price) {
  const n = Math.max(0, parseInt(document.getElementById('evqty').value, 10) || 0);
  document.querySelectorAll('[data-evn]').forEach(x => { x.textContent = n; });
  document.querySelectorAll('[data-evtotal]').forEach(x => { x.textContent = K(n * price); });
}
function registerEvent(i) {
  const m = me(), e = S.events[i], price = ticketPrice(e), qty = document.getElementById('evqty');
  const n = Number(qty.value), max = Math.min(e.cap - e.reg, MAX_TICKETS), bad = !(Number.isInteger(n) && n >= 1 && n <= max);
  qty.classList.toggle('is-invalid', bad); if (bad) return;
  const add = (status, refs) => { S.registered.push({ event: e.name, member: m.id, tickets: n, amt: n * price, status, refs, at: new Date().toISOString() }); e.reg += n; };
  if (!price) {
    add('confirmed'); log(m.id, 'calendar-check', 'primary', `Registered for ${e.name}`, tix(n));
    audit(m.id, 'Event registration', `${e.name} · ${tix(n)}`, `${m.contact} (member)`);
    commit(); toast(`Registered for ${tix(n)}. Confirmation sent to ${m.email}`); return rerender();
  }
  takePayment('evpay', {
    payer: m.name, description: `${e.name} · ${tix(n)}`, link: { memberId: m.id, event: e.name },
    items: [{ type: `Event: ${e.name} (${n} × ${K(price)})`, amt: n * price }],
    onDone: ({ refs, pending, method, detail }) => {
      if (pending) { add('pending', refs); audit(m.id, 'Proof of payment submitted', `${e.name} · ${tix(n)} · ${K(n * price)} · bank transfer · ref ${detail}`, `${m.contact} (member)`); }
      else {
        add('confirmed', refs); log(m.id, 'calendar-check', 'primary', `Registered for ${e.name}`, `${tix(n)} · ${K(n * price)} · ${method}`);
        audit(m.id, 'Event tickets paid online', `${e.name} · ${tix(n)} · ${K(n * price)} · ${method} · ${refs[0]}`, `${m.contact} (member)`);
      }
      setTimeout(rerender, 50);
    },
  });
}
function cancelReg(i) {
  const m = me(), e = S.events[i];
  confirmModal({
    title: 'Cancel registration', body: `Cancel your registration for <b>${esc(e.name)}</b>?`, confirmText: 'Cancel registration', tone: 'danger',
    onConfirm: () => {
      const at = S.registered.findIndex(r => r.event === e.name && r.member === m.id); if (at < 0) return;
      e.reg = Math.max(0, e.reg - (S.registered[at].tickets || 1)); S.registered.splice(at, 1);
      audit(m.id, 'Event registration cancelled', e.name, `${m.contact} (member)`); commit(); toast('Registration cancelled'); rerender();
    },
  });
}

/* ================= CUSTOMERS & CREDIT CHECKS ================= */
let CFILTER = 'all', CQUERY = '', LOOKUP = null; // LOOKUP: { nrc, rec } from the last NRC search
const scoreBadge = s => `<span class="badge rounded-pill bg-${isGood(s) ? 'success' : 'danger'}-subtle text-${isGood(s) ? 'success' : 'danger'}-emphasis border border-${isGood(s) ? 'success' : 'danger'}-subtle">${s} · ${isGood(s) ? 'Good' : 'Bad'}</span>`;
const LOAN_STATUS = { current: ['Current', 'success'], arrears: ['In arrears', 'danger'], closed: ['Closed', 'secondary'] };
const loanBadge = s => { const [t, tone] = LOAN_STATUS[s]; return `<span class="badge rounded-pill bg-${tone}-subtle text-${tone}-emphasis border border-${tone}-subtle">${t}</span>`; };
const ageOf = dob => Math.floor((Date.now() - new Date(dob)) / 3.15576e10);

function creditReport(c) {
  const good = isGood(c.score), pct = Math.round((c.score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN) * 100);
  const row = (k, v) => `<div class="d-flex justify-content-between gap-2 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
  return `<div class="row g-4"><div class="col-md-5">
      <div class="text-center border rounded p-3 mb-3">
        <div class="small text-body-secondary">Credit score</div>
        <div class="display-5 fw-semibold text-${good ? 'success' : 'danger'}-emphasis">${c.score}</div>
        <div class="mb-2">${scoreBadge(c.score)}</div>
        <div class="progress" style="height:6px" role="progressbar" aria-label="Score" aria-valuenow="${c.score}" aria-valuemin="${SCORE_MIN}" aria-valuemax="${SCORE_MAX}"><div class="progress-bar bg-${good ? 'success' : 'danger'}" style="width:${pct}%"></div></div>
        <div class="d-flex justify-content-between small text-body-secondary mt-1"><span>${SCORE_MIN}</span><span>${GOOD_SCORE}+ good</span><span>${SCORE_MAX}</span></div>
      </div>
      ${row('Name', esc(c.name))}${row('NRC', `<span class="font-monospace">${esc(c.nrc)}</span>`)}${row('Date of birth', `${fmtDate(c.dob)} (${ageOf(c.dob)})`)}${row('Phone', esc(c.phone))}${row('Town', esc(c.town))}
    </div><div class="col-md-7">
      <div class="small fw-semibold mb-1">Employment</div>
      ${row('Employer', esc(c.employer))}${row('Monthly income (declared)', K(c.income))}
      <div class="small fw-semibold mt-3 mb-1">Credit history</div>
      ${row('Repayments on time', `${c.onTime}%`)}${row('Active loans', c.activeLoans)}${row('Total owed to lenders', K(c.totalOwed))}
      ${row('Defaults (last 5 years)', c.defaults ? `<span class="text-danger-emphasis">${c.defaults}</span>` : '0')}${row('Credit enquiries (last 6 months)', c.enquiries)}
      ${c.lenders.length ? row('Current lenders', c.lenders.map(esc).join('<br>')) : ''}
      ${c.loan ? `<div class="small fw-semibold mt-3 mb-1">Loan with you</div>${row('Amount', K(c.loan.amount))}${row('Balance', K(c.loan.balance))}${row('Issued', fmtDate(c.loan.issued))}${row('Status', loanBadge(c.loan.status))}` : ''}
    </div></div>
    <div class="small text-body-secondary mt-3">${icon('info-circle', 'me-1')}Simulated credit bureau data for demonstration. Scores of ${GOOD_SCORE} and above are rated good.</div>`;
}

function customers() {
  const m = me(), book = customersOf(m.id);
  const good = book.filter(c => isGood(c.score)).length, avg = Math.round(book.reduce((n, c) => n + c.score, 0) / book.length);
  const q = CQUERY.toLowerCase();
  const shown = book.filter(c => (CFILTER === 'all' || (CFILTER === 'good') === isGood(c.score)) && (!q || c.name.toLowerCase().includes(q) || c.nrc.includes(q)));
  const chip = (k, label) => `<button class="btn btn-sm ${CFILTER === k ? 'btn-primary' : 'btn-outline-secondary'}" onclick="setCFilter('${k}')">${label}</button>`;
  const result = !LOOKUP ? '' : LOOKUP.rec
    ? `<div class="card mb-4 border-primary-subtle"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1">Credit report · ${esc(LOOKUP.rec.name)}</h2>${LOOKUP.rec.loan ? '<span class="badge bg-primary-subtle text-primary-emphasis ms-2">Your customer</span>' : ''}<button class="btn-close ms-auto" aria-label="Close" onclick="clearLookup()"></button></div><div class="card-body">${creditReport(LOOKUP.rec)}</div></div>`
    : `<div class="alert alert-warning d-flex align-items-center gap-2">${icon('person-x')}<div class="me-auto">The credit bureau has no record for NRC <b class="font-monospace">${esc(LOOKUP.nrc)}</b>. Ask the customer for another form of identification or a payslip.</div><button class="btn-close" aria-label="Close" onclick="clearLookup()"></button></div>`;
  return pageHeader('Customers', 'Your borrowers and their credit scores, plus credit checks on any NRC')
    + `<div class="card mb-4"><div class="card-body">
      <form class="row g-2 align-items-start" novalidate onsubmit="event.preventDefault();searchNrc(this)">
        <div class="col-md"><label class="form-label small fw-medium" for="nrcq">Credit check by NRC number</label>
          <input class="form-control font-monospace" id="nrcq" name="nrc" required ${NRC_ATTRS} value="${esc(LOOKUP?.nrc || '')}">
          <div class="invalid-feedback">Enter all 9 digits, e.g. 284512/11/1.</div>
          <div class="form-text">Searches the credit bureau for anyone, not only your customers. Every check is logged.</div></div>
        <div class="col-md-auto"><label class="form-label small d-none d-md-block">&nbsp;</label><button class="btn btn-primary w-100">${icon('search', 'me-1')} Check credit</button></div>
      </form></div></div>
    ${result}
    <div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('Customers', book.length, `${book.filter(c => c.loan.status !== 'closed').length} with open loans`, 'people', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Good scores', good, `${GOOD_SCORE} and above`, 'hand-thumbs-up', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Bad scores', book.length - good, `below ${GOOD_SCORE}`, 'hand-thumbs-down', 'danger')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Average score', avg, isGood(avg) ? 'Good overall' : 'Below the good threshold', 'speedometer2', 'info')}</div>
    </div>
    <div class="card"><div class="card-header bg-white d-flex flex-wrap gap-2 align-items-center">
      <h2 class="h6 mb-0 py-1 me-auto">Your customers</h2>
      <input class="form-control form-control-sm" style="max-width:220px" type="search" placeholder="Filter by name or NRC" value="${esc(CQUERY)}" oninput="setCQuery(this.value)">
      <div class="d-flex gap-1">${chip('all', 'All')}${chip('good', 'Good')}${chip('bad', 'Bad')}</div>
    </div><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Customer</th><th>NRC</th><th class="text-end">Loan</th><th class="text-end">Balance</th><th>Status</th><th>Credit score</th><th></th></tr></thead><tbody>
      ${shown.map(c => `<tr><td><div class="fw-medium">${esc(c.name)}</div><div class="small text-body-secondary">${esc(c.town)}</div></td><td class="small font-monospace">${esc(c.nrc)}</td>
        <td class="text-end">${K(c.loan.amount)}</td><td class="text-end">${K(c.loan.balance)}</td><td>${loanBadge(c.loan.status)}</td><td>${scoreBadge(c.score)}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-secondary" onclick="viewCustomer('${c.nrc}')">View</button></td></tr>`).join('')
        || `<tr><td colspan="7">${empty('No customers match.', 'people')}</td></tr>`}
    </tbody></table></div></div>`;
}
function setCFilter(k) { CFILTER = k; rerender(); }
function setCQuery(v) {
  CQUERY = v; rerender();
  const el = document.querySelector('input[type=search]'); el.focus(); el.setSelectionRange(v.length, v.length);
}
function clearLookup() { LOOKUP = null; rerender(); }
function viewCustomer(nrc) {
  const c = customersOf(me().id).find(x => x.nrc === nrc);
  modal({ title: `Credit report · ${esc(c.name)}`, size: 'lg', body: creditReport(c), footer: '<button class="btn btn-primary" data-bs-dismiss="modal">Close</button>' });
}
function searchNrc(form) {
  const v = readForm(form); if (!v) return;
  const m = me(), own = customersOf(m.id).find(c => c.nrc === v.nrc);
  LOOKUP = { nrc: v.nrc, rec: own || lookup(v.nrc) };
  audit(m.id, 'Credit check', `NRC ${v.nrc} · ${LOOKUP.rec ? `score ${LOOKUP.rec.score}` : 'no bureau record'}`, `${m.contact} (member)`);
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
  ['Lending', [['customers', 'Customers', 'people']]],
  ['Engage', [['events', 'Events', 'calendar-event'], ['announcements', 'Announcements', 'megaphone'], ['profile', 'Business profile', 'building']]],
];
export const MEMBER_PAGES = { overview, certificates, dues, customers, events, announcements, profile };
export const currentMember = me;
expose({ uploadRenewal, payDues, evQty, registerEvent, cancelReg, setCFilter, setCQuery, clearLookup, viewCustomer, searchNrc, saveProfile });

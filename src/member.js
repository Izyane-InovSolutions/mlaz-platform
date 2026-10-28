import {
  esc, K, fmtDate, fmtDateTime, today, icon, statusBadge, accredBadge, mofBadge, payBadge, pageHeader, statCard, empty, listItem,
  toast, asyncModal, readForm, rerender, expose, busy, on, EL, NRC_ATTRS,
} from './ui.js';
import { api, download, publicConfig } from './api.js';
import { checkoutForm, readCheckout, runCheckout } from './checkout.js';
import { accountCard } from './security.js';

// Member portal. Everything is scoped by the server to the signed-in user's own business (/api/portal).

const portal = (path, opts) => api(`/portal${path}`, opts);
const lower = s => String(s || '').toLowerCase();
const done = msg => { toast(msg); rerender(); };
const fail = e => toast(e.message, 'error');
const note = (tone, ic, html, cls = '') => `<div class="alert alert-${tone} small d-flex gap-2 ${cls}">${icon(ic)}<div>${html}</div></div>`;
const row = (k, v) => `<div class="d-flex justify-content-between gap-3 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v ?? '—'}</span></div>`;
const tix = n => `${n} ticket${n === 1 ? '' : 's'}`;
const EVENT_TYPE = { TRAINING: 'Training', WEBINAR: 'Webinar', AGM: 'AGM', NETWORKING: 'Networking' };
const badge = (text, tone) => `<span class="badge rounded-pill bg-${tone}-subtle text-${tone}-emphasis border border-${tone}-subtle">${text}</span>`;
const duesBadge = d => d.overdue ? badge('Overdue', 'danger') : d.payable ? badge('Due', 'warning') : badge('Paid', 'success');

/* ================= SHARED STATE ================= */
// The latest member summary, refreshed by the router on every portal page (for the sidebar badge and the header).
let ME = null;
export async function refreshMember() { try { ME = await portal('/profile'); } catch (e) { /* keep the last one */ } return ME; }
export const currentMember = () => ME;

async function getFile(path, btn) {
  busy(btn, true, 'Preparing…');
  try { await download(path); } catch (e) { fail(e); } finally { busy(btn, false); }
}

/** Bank details and proof-of-payment upload for a pending bank transfer. */
function bankTransferBlock(p) {
  if (!p.awaitingProof) return note('info', 'hourglass-split', `We’ve received your proof of payment for <b>${K(p.amount)}</b> (bank ref ${esc(p.bankRef)}). MLAZ Finance will confirm the transfer, usually within 1 working day; your receipt follows.`, 'mb-0');
  const b = p.bankAccount || {};
  const line = (k, v) => `<div class="d-flex justify-content-between gap-2"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
  return `<div class="bg-body-tertiary rounded p-3 small d-grid gap-1 mb-3"><div class="fw-semibold mb-1">Pay ${K(p.amount)} into this account</div>
      ${line('Bank', esc(b.bank))}${line('Account name', esc(b.name))}${line('Account number', `<span class="font-monospace">${esc(b.number)}</span>`)}${line('Branch', esc(b.branch))}${line('Payment reference', `<span class="font-monospace">${esc(p.ref)}</span>`)}</div>
    <form class="d-grid gap-2" novalidate ${on('submit', 'submitProof', p.ref, EL)}>
      <div><label class="form-label small fw-medium">Your bank transaction reference</label><input class="form-control" name="bankRef" required maxlength="60" placeholder="e.g. FT26285ABC12"><div class="invalid-feedback">Required.</div></div>
      <div><label class="form-label small fw-medium">Proof of payment <span class="text-body-secondary fw-normal">(PDF, JPG or PNG)</span></label><input class="form-control" type="file" name="proof" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach your deposit slip or transfer confirmation.</div></div>
      <button class="btn btn-primary">Submit proof of payment</button></form>`;
}
async function submitProof(ref, form) {
  if (!readForm(form)) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Uploading…');
  try { await portal(`/payments/${encodeURIComponent(ref)}/proof`, { method: 'POST', form: new FormData(form) }); done('Proof of payment submitted'); }
  catch (e) { busy(btn, false); fail(e); }
}
async function startCheckout(start, btn) {
  busy(btn, true, 'Starting payment…');
  try {
    await runCheckout({
      start, poll: ref => portal(`/payments/${encodeURIComponent(ref)}`),
      receipt: ref => getFile(`/portal/payments/${encodeURIComponent(ref)}/receipt.pdf`),
      onDone: () => rerender(),
    });
  } catch (e) { fail(e); if (e.status === 409) rerender(); } finally { busy(btn, false); }
}
// A gateway payment still in progress: look again shortly, only while the same page stays open.
function pollLater() {
  const hash = location.hash;
  setTimeout(() => { if (location.hash === hash) rerender(); }, 5000);
  return '';
}

/* ================= OVERVIEW ================= */
const ACTIVITY = {
  dues_paid: ['credit-card', 'warning'], accreditation_issued: ['award', 'success'], suspended: ['slash-circle', 'danger'], reinstated: ['arrow-counterclockwise', 'success'],
  reminder_sent: ['envelope', 'info'], mof_renewal: ['file-earmark-check', 'info'], profile_updated: ['pencil', 'secondary'], event_registered: ['calendar-check', 'primary'], lapsed: ['hourglass-bottom', 'warning'],
};

async function overview() {
  const o = await portal('/overview'), m = o.member;
  return `<div class="card band-dark border-0 shadow-sm mb-4"><div class="card-body p-4">
      <h1 class="h4 mb-1">${esc(m.name)}</h1><div class="small opacity-75">Member ${esc(m.number)} · ${esc(m.tier)} tier · ${esc(m.town)}</div>
    </div></div>`
    + o.alerts.map(a => `<div class="alert alert-${{ danger: 'danger', warning: 'warning' }[a.level] || 'info'} d-flex align-items-center gap-2">${icon(a.level === 'danger' ? 'exclamation-octagon' : 'info-circle')}<div class="me-auto">${esc(a.message)}</div>
        ${a.code === 'DUES_PAYABLE' || a.code === 'LAPSED' ? '<a class="btn btn-sm btn-warning" href="#/app/dues">Pay now</a>' : a.code === 'MOF_EXPIRED' ? '<a class="btn btn-sm btn-light" href="#/app/certificates">Upload</a>' : ''}</div>`).join('')
    + `<div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('Membership', statusBadge(lower(m.status)), m.goodStanding ? 'In good standing' : 'Not in good standing', 'person-check', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('MoF authorization', m.pendingRenewal ? badge('Renewal pending', 'warning') : mofBadge(lower(m.mofStatus)), `${esc(m.mofRef)}${m.mofExpiry ? ` · expires ${fmtDate(m.mofExpiry)}` : ''}`, 'file-earmark-check', 'info')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Accreditation', accredBadge(lower(m.accreditation)), `Valid until ${fmtDate(m.validUntil)}`, 'award', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Annual dues', duesBadge(m.dues), m.dues.payable ? `${K(m.dues.amount)} payable` : `Next payable from ${fmtDate(m.dues.opensOn)}`, 'cash-stack', 'warning')}</div>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Quick actions</h2></div><div class="list-group list-group-flush">
        ${listItem('award', 'success', 'Accreditation certificate', m.certificate ? esc(m.certificate.serial) : 'Not issued', m.goodStanding && m.certificate ? `<button class="btn btn-sm btn-outline-secondary" ${on('click', 'getFile', '/portal/certificate.pdf', EL)}>Download</button>` : '')}
        ${listItem('file-earmark-arrow-up', 'info', 'Renew MoF authorization', m.mofExpiry ? `Expires ${fmtDate(m.mofExpiry)}` : esc(m.mofRef), '<a class="btn btn-sm btn-outline-secondary" href="#/app/certificates">Upload</a>')}
        ${listItem('credit-card', 'warning', 'Pay annual dues', m.dues.payable ? `${K(m.dues.amount)} due` : `Paid until ${fmtDate(m.validUntil)}`, '<a class="btn btn-sm btn-outline-secondary" href="#/app/dues">Open</a>')}
        ${o.nextEvent ? listItem('calendar-event', 'primary', esc(o.nextEvent.name), `${fmtDate(o.nextEvent.date)} · ${esc(o.nextEvent.venue)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/events/${encodeURIComponent(o.nextEvent.id)}">View</a>`) : ''}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Announcements</h2><a class="ms-auto small" href="#/app/announcements">View all</a></div><div class="list-group list-group-flush">
        ${o.announcements.map(a => listItem('megaphone', 'primary', esc(a.title), fmtDate(a.publishedAt))).join('') || empty('No announcements.')}
      </div></div></div>
    </div>
    <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Recent activity</h2></div><div class="list-group list-group-flush">
      ${o.activity.map(a => { const [ic, t] = ACTIVITY[a.kind] || ['dot', 'secondary']; return listItem(ic, t, esc(a.title), `${esc(a.detail)}${a.detail ? ' · ' : ''}${fmtDateTime(a.at)}`); }).join('') || empty('No activity yet.', 'activity')}
    </div></div>`;
}

/* ================= CERTIFICATES & MoF ================= */
async function certificates() {
  const [m, renewals] = await Promise.all([portal('/profile'), portal('/mof-renewals')]);
  const pending = renewals.find(r => r.status === 'PENDING');
  const lastRejected = !pending && renewals[0]?.status === 'REJECTED' ? renewals[0] : null;
  return pageHeader('Certificates', 'Your Ministry of Finance authorization and MLAZ accreditation')
    + `<div class="row g-3 mb-3">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">1</span>Ministry of Finance authorization</h2></div><div class="card-body">
        ${row('Reference', esc(m.mofRef))}${row('Status', mofBadge(lower(m.mofStatus)))}${row('Expires', m.mofExpiry ? fmtDate(m.mofExpiry) : '—')}
        ${pending ? note('info', 'hourglass-split', `Renewal <b>${esc(pending.mofRef)}</b> uploaded ${fmtDate(pending.submittedAt)} and awaiting verification by the Secretariat.`, 'mt-3 mb-0')
        : `${lastRejected ? note('danger', 'x-octagon', `Your last renewal (${esc(lastRejected.mofRef)}) was not accepted: ${esc(lastRejected.reviewNote || '')}`, 'mt-3') : ''}
          <form class="mt-3" novalidate ${on('submit', 'uploadRenewal', EL)}><h3 class="h6 mt-2">Upload a renewed authorization</h3>
          <div class="row g-2"><div class="col-md-6"><input class="form-control" name="mofRef" required maxlength="60" placeholder="New reference, e.g. MoF/ML/2027/0001"><div class="invalid-feedback">Required.</div></div>
          <div class="col-md-6"><input class="form-control" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach the document.</div></div>
          <div class="col-12"><button class="btn btn-primary">${icon('upload', 'me-1')} Submit for verification</button></div></div></form>`}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">2</span>MLAZ accreditation</h2></div><div class="card-body d-flex flex-column">
        ${row('Certificate no.', m.certificate ? `<span class="font-monospace">${esc(m.certificate.serial)}</span>` : '—')}${row('Status', accredBadge(lower(m.accreditation)))}${row('Valid until', fmtDate(m.validUntil))}
        <p class="small text-body-secondary mt-3">Issued after your MoF authorization was verified and dues paid. Anyone can verify it by scanning the QR code.</p>
        <button class="btn btn-primary mt-auto" ${m.goodStanding && m.certificate ? '' : 'disabled'} ${on('click', 'getFile', '/portal/certificate.pdf', EL)}>${icon('download', 'me-1')} Download certificate (PDF)</button>
      </div></div></div>
    </div>
    ${note('light border', 'info-circle', 'Your MoF authorization is verified <b>first</b>, then your MLAZ accreditation is issued. If your MoF authorization lapses, your accreditation is suspended until a renewal is verified.')}`;
}
async function uploadRenewal(form) {
  if (!readForm(form)) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Uploading…');
  try { await portal('/mof-renewals', { method: 'POST', form: new FormData(form) }); done('Authorization submitted for verification'); }
  catch (e) { busy(btn, false); fail(e); }
}

/* ================= DUES & PAYMENTS ================= */
async function dues() {
  const [d, payments, cfg] = await Promise.all([portal('/dues'), portal('/payments'), publicConfig()]);
  const p = d.pendingPayment;
  let panel;
  if (p?.method === 'BANK_TRANSFER') panel = bankTransferBlock(p);
  else if (p) panel = note('info', 'hourglass-split', `Payment ${esc(p.ref)} (${K(p.amount)} by ${esc(p.methodLabel)}) is waiting for confirmation. This page updates when it is confirmed.`, 'mb-0') + pollLater();
  else if (d.payable) panel = `${checkoutForm('duespay', { methods: cfg.paymentMethods, phone: ME?.contactPhone || '' })}
      <button class="btn btn-primary w-100 mt-3" ${on('click', 'payDues', EL)}>Pay ${K(d.amount)}</button>
      <div class="small text-body-secondary text-center mt-2">${icon('lock', 'me-1')}Secured payment · receipt emailed automatically</div>`;
  else panel = note('success', 'check-circle', `Your dues are paid until <b>${fmtDate(d.validUntil)}</b>. The next payment opens on ${fmtDate(d.opensOn)}.`, 'mb-0');
  return pageHeader('Dues & payments', 'Pay your annual membership dues online')
    + `<div class="row g-3"><div class="col-lg-5"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Annual dues</h2></div><div class="card-body">
      ${row(`${esc(d.tier)} tier`, K(d.amount))}${row('Next period', `${fmtDate(d.periodStart)} to ${fmtDate(d.periodEnd)}`)}
      <div class="d-flex justify-content-between fw-semibold py-2 mb-3"><span>Balance due</span><span>${d.payable && !p ? K(d.amount) : K(0)}</span></div>
      ${panel}
    </div></div></div>
    <div class="col-lg-7"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Payment history</h2></div>
      <div class="table-responsive"><table class="table align-middle mb-0 small"><thead><tr><th>Description</th><th>Method</th><th>Date</th><th class="text-end">Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${payments.map(x => `<tr><td>${esc(x.event ? `Event: ${x.event.name}` : x.lines.map(l => l.description).join(' · '))}<div class="text-body-secondary font-monospace">${esc(x.ref)}</div></td><td>${esc(x.methodLabel)}</td><td>${fmtDate(x.paidAt || x.createdAt)}</td>
        <td class="text-end fw-medium">${K(x.amount)}</td><td>${payBadge(lower(x.status))}</td>
        <td class="text-end">${x.status === 'SUCCESS' ? `<button class="btn btn-sm btn-light" title="Receipt" ${on('click', 'getFile', `/portal/payments/${encodeURIComponent(x.ref)}/receipt.pdf`, EL)}>${icon('receipt')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6">${empty('No payments yet.', 'credit-card')}</td></tr>`}
      </tbody></table></div></div></div></div>`;
}
function payDues(btn) {
  const checkout = readCheckout('duespay'); if (!checkout) return;
  startCheckout(() => portal('/dues/payments', { method: 'POST', body: checkout }), btn);
}

/* ================= EVENTS ================= */
const MAX_TICKETS = 10;
async function events(id) {
  if (id) return eventPage(id);
  const list = await portal('/events');
  return pageHeader('Events', 'Register for MLAZ events')
    + `<div class="row g-3">${list.map(e => {
      const r = e.myRegistration, full = e.placesLeft <= 0, href = `#/app/events/${encodeURIComponent(e.id)}`;
      return `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
        <div class="d-flex justify-content-between mb-2"><span class="badge bg-info-subtle text-info-emphasis">${esc(EVENT_TYPE[e.type] || e.type)}</span><span class="small text-body-secondary">${fmtDate(e.date)}</span></div>
        <h2 class="h6 fw-semibold mb-1">${esc(e.name)}</h2><div class="small text-body-secondary mb-2">${icon('geo-alt', 'me-1')}${esc(e.venue)} · ${e.placesLeft} place${e.placesLeft === 1 ? '' : 's'} left</div>
        <div class="small fw-semibold mb-3">${icon('ticket-perforated', 'me-1 text-primary')}${e.price ? `${K(e.price)} per ticket` : 'Free'}</div>
        <div class="mt-auto">${r ? `<a class="btn btn-sm w-100 ${r.status === 'PENDING' ? 'btn-outline-info' : 'btn-outline-success'}" href="${href}">${r.status === 'PENDING' ? `${icon('hourglass-split', 'me-1')}Payment pending` : `${icon('check-lg', 'me-1')}Registered · ${tix(r.tickets)}`}</a>`
          : `<a class="btn btn-sm btn-primary w-100 ${full ? 'disabled' : ''}" href="${href}">${full ? 'Fully booked' : 'Register'}</a>`}</div>
      </div></div></div>`; }).join('') || `<div class="col-12">${empty('No upcoming events.', 'calendar')}</div>`}</div>`;
}
let CUR_EVENT = null;
async function eventPage(id) {
  const [e, cfg] = await Promise.all([portal(`/events/${encodeURIComponent(id)}`), publicConfig()]);
  CUR_EVENT = e;
  const crumbs = `<li class="breadcrumb-item"><a href="#/app/events">Events</a></li><li class="breadcrumb-item active">${esc(e.name)}</li>`;
  const r = e.myRegistration, max = Math.min(e.placesLeft, e.maxTickets || MAX_TICKETS);
  let panel;
  if (r) {
    let pending = '';
    if (r.status === 'PENDING' && r.payment) {
      const p = await portal(`/payments/${encodeURIComponent(r.payment.ref)}`);
      pending = p.method === 'BANK_TRANSFER' ? `<div class="mt-3">${bankTransferBlock(p)}</div>` : note('info', 'hourglass-split', `Payment ${esc(p.ref)} is waiting for confirmation. Your places are held meanwhile.`, 'mt-3 mb-0') + pollLater();
    }
    panel = `<div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Your registration</h2></div><div class="card-body">
      ${row('Tickets', tix(r.tickets))}${row('Amount', Number(r.amount) ? K(r.amount) : 'Free')}${row('Status', r.status === 'PENDING' ? badge('Payment pending', 'warning') : badge('Confirmed', 'success'))}
      ${pending}
      ${r.status === 'CONFIRMED' ? `<div class="d-flex gap-2 mt-3">${r.payment ? `<button class="btn btn-outline-secondary flex-grow-1" ${on('click', 'getFile', `/portal/payments/${encodeURIComponent(r.payment.ref)}/receipt.pdf`, EL)}>${icon('receipt', 'me-1')} Receipt</button>` : ''}
        ${Number(r.amount) ? '' : '<button class="btn btn-light flex-grow-1" data-on-click="cancelReg">Cancel registration</button>'}</div>
        ${Number(r.amount) ? `<div class="small text-body-secondary mt-3">${icon('info-circle', 'me-1')}To change or cancel a paid registration, contact the Secretariat.</div>` : ''}` : ''}
    </div>`;
  } else if (e.status !== 'PUBLISHED') {
    panel = `<div class="card-body">${note('danger', 'x-octagon', `This event has been cancelled. ${esc(e.cancelReason || '')}`, 'mb-0')}</div>`;
  } else if (max <= 0) {
    panel = `<div class="card-body">${empty('This event is fully booked.', 'calendar-x')}</div>`;
  } else {
    panel = `<div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Register</h2></div><div class="card-body">
      <label class="form-label small fw-medium" for="evqty">Number of tickets</label>
      <input class="form-control" type="number" id="evqty" min="1" max="${max}" value="1" required ${on('input', 'evQty')}>
      <div class="invalid-feedback">Choose between 1 and ${max}.</div>
      <div class="small text-body-secondary mt-1 mb-3">Up to ${tix(max)} per booking · ${e.placesLeft} places left</div>
      ${e.price ? `<div class="d-flex justify-content-between fw-semibold py-2 mb-3 border-top"><span>Total</span><span data-evtotal>${K(e.price)}</span></div>
      ${checkoutForm('evpay', { methods: cfg.paymentMethods, phone: ME?.contactPhone || '' })}
      <button class="btn btn-primary w-100 mt-3" ${on('click', 'registerEvent', EL)}>Pay and register</button>
      <div class="small text-body-secondary text-center mt-2">${icon('lock', 'me-1')}Secured payment · receipt emailed automatically</div>`
      : `<button class="btn btn-primary w-100" ${on('click', 'registerEvent', EL)}>Register</button>`}
    </div>`;
  }
  return pageHeader(esc(e.name), `${esc(EVENT_TYPE[e.type] || e.type)} · ${fmtDate(e.date)}`, '', crumbs)
    + `<div class="row g-3"><div class="col-lg-5"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Event details</h2></div><div class="card-body">
      ${row('Date', fmtDate(e.date))}${row('Venue', esc(e.venue))}${row('Type', esc(EVENT_TYPE[e.type] || e.type))}${row('Ticket price', e.price ? K(e.price) : 'Free')}${row('Places left', `${e.placesLeft} of ${e.capacity}`)}
      ${e.description ? `<p class="small mt-3 mb-0" style="white-space:pre-line">${esc(e.description)}</p>` : ''}
    </div></div></div><div class="col-lg-7"><div class="card">${panel}</div></div></div>`;
}
function evQty() {
  const n = Math.max(0, parseInt(document.getElementById('evqty').value, 10) || 0);
  document.querySelectorAll('[data-evtotal]').forEach(x => { x.textContent = K(n * CUR_EVENT.price); });
}
function registerEvent(btn) {
  const e = CUR_EVENT, qty = document.getElementById('evqty'), n = Number(qty.value);
  const max = Math.min(e.placesLeft, e.maxTickets || MAX_TICKETS), bad = !(Number.isInteger(n) && n >= 1 && n <= max);
  qty.classList.toggle('is-invalid', bad); if (bad) return;
  const url = `/events/${encodeURIComponent(e.id)}/registrations`;
  if (!e.price) {
    busy(btn, true, 'Registering…');
    portal(url, { method: 'POST', body: { tickets: n } }).then(() => done(`Registered for ${tix(n)}. A confirmation has been emailed`)).catch(err => { busy(btn, false); fail(err); });
    return;
  }
  const checkout = readCheckout('evpay'); if (!checkout) return;
  startCheckout(async () => (await portal(url, { method: 'POST', body: { tickets: n, ...checkout } })).payment, btn);
}
function cancelReg() {
  asyncModal({
    title: 'Cancel registration', confirmText: 'Cancel registration', tone: 'danger', body: `<p class="mb-0">Cancel your registration for <b>${esc(CUR_EVENT.name)}</b>?</p>`,
    onSubmit: async () => { await portal(`/events/${encodeURIComponent(CUR_EVENT.id)}/registration`, { method: 'DELETE' }); done('Registration cancelled'); },
  });
}

/* ================= CUSTOMERS & CREDIT CHECKS ================= */
let CS = { filter: 'all', q: '' }, LOOKUP = null, SCALE = { min: 300, max: 850, good: 600 }, LOANS = [];
const LOAN_STATUS = { CURRENT: ['Current', 'success'], ARREARS: ['In arrears', 'danger'], CLOSED: ['Closed', 'secondary'] };
const loanBadge = s => { const [t, tone] = LOAN_STATUS[s] || [s, 'secondary']; return badge(esc(t), tone); };
const scoreBadge = (s, rating) => s == null ? '<span class="small text-body-secondary">Not checked</span>' : badge(`${s} · ${rating === 'GOOD' ? 'Good' : 'Bad'}`, rating === 'GOOD' ? 'success' : 'danger');
const PURPOSE = { NEW_LOAN: 'Assessing a new loan', LOAN_REVIEW: 'Reviewing an existing loan', COLLECTIONS: 'Collections on an overdue loan' };
const ageOf = dob => Math.floor((Date.now() - new Date(dob)) / 3.15576e10);

function creditReport(c) {
  const good = c.rating === 'GOOD', pct = Math.round((c.score - SCALE.min) / (SCALE.max - SCALE.min) * 100);
  return `<div class="row g-4"><div class="col-md-5">
      <div class="text-center border rounded p-3 mb-3">
        <div class="small text-body-secondary">Credit score</div>
        <div class="display-5 fw-semibold text-${good ? 'success' : 'danger'}-emphasis">${Number(c.score)}</div>
        <div class="mb-2">${scoreBadge(c.score, c.rating)}</div>
        <div class="progress" style="height:6px" role="progressbar" aria-label="Score" aria-valuenow="${Number(c.score)}" aria-valuemin="${SCALE.min}" aria-valuemax="${SCALE.max}"><div class="progress-bar bg-${good ? 'success' : 'danger'}" style="width:${pct}%"></div></div>
        <div class="d-flex justify-content-between small text-body-secondary mt-1"><span>${SCALE.min}</span><span>${SCALE.good}+ good</span><span>${SCALE.max}</span></div>
      </div>
      ${row('Name', esc(c.name))}${row('NRC', `<span class="font-monospace">${esc(c.nrc)}</span>`)}${row('Date of birth', `${fmtDate(c.dob)} (${ageOf(c.dob)})`)}${row('Phone', esc(c.phone))}${row('Town', esc(c.town))}
    </div><div class="col-md-7">
      <div class="small fw-semibold mb-1">Employment</div>${row('Employer', esc(c.employer))}${row('Monthly income (declared)', K(c.income))}
      <div class="small fw-semibold mt-3 mb-1">Credit history</div>
      ${row('Repayments on time', `${Number(c.onTime)}%`)}${row('Active loans', Number(c.activeLoans))}${row('Total owed to lenders', K(c.totalOwed))}
      ${row('Defaults (last 5 years)', c.defaults ? `<span class="text-danger-emphasis">${Number(c.defaults)}</span>` : '0')}${row('Credit enquiries (last 6 months)', Number(c.enquiries))}
      ${c.lenders?.length ? row('Current lenders', c.lenders.map(esc).join('<br>')) : ''}
    </div></div>`;
}

async function customers() {
  const [r, history] = await Promise.all([portal(`/loans?${new URLSearchParams({ filter: CS.filter, ...(CS.q && { q: CS.q }) })}`), portal('/credit-checks')]);
  LOANS = r.items; SCALE = r.scale;
  const s = r.summary;
  const chip = (k, label) => `<button class="btn btn-sm ${CS.filter === k ? 'btn-primary' : 'btn-outline-secondary'}" ${on('click', 'setCFilter', k)}>${label}</button>`;
  const result = !LOOKUP ? '' : LOOKUP.found
    ? `<div class="card mb-4 border-primary-subtle"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1">Credit report · ${esc(LOOKUP.report.name)}</h2>${LOOKUP.yourLoans.length ? '<span class="badge bg-primary-subtle text-primary-emphasis ms-2">Your customer</span>' : ''}<button class="btn-close ms-auto" aria-label="Close" ${on('click', 'clearLookup')}></button></div>
        <div class="card-body">${creditReport(LOOKUP.report)}<div class="small text-body-secondary mt-3">${icon('info-circle', 'me-1')}Check logged with your name and the purpose you gave. ${Number(LOOKUP.checksLeftToday)} check${LOOKUP.checksLeftToday === 1 ? '' : 's'} left today.</div></div></div>`
    : note('warning', 'person-x', `The credit bureau has no record for NRC <b class="font-monospace">${esc(LOOKUP.nrc)}</b>. Ask the customer for another form of identification or a payslip.`);
  return pageHeader('Customers', 'Your loan book and credit checks with the bureau', `<button class="btn btn-primary" ${on('click', 'addLoan')}>${icon('plus-lg', 'me-1')} Add customer loan</button>`)
    + `<div class="card mb-4"><div class="card-body">
      <form class="row g-2 align-items-start" novalidate ${on('submit', 'searchNrc', EL)}>
        <div class="col-md-4"><label class="form-label small fw-medium" for="nrcq">Credit check by NRC number</label>
          <input class="form-control font-monospace" id="nrcq" name="nrc" required ${NRC_ATTRS}><div class="invalid-feedback">Enter all 9 digits, e.g. 284512/11/1.</div></div>
        <div class="col-md-4"><label class="form-label small fw-medium" for="purpose">Purpose</label><select class="form-select" id="purpose" name="purpose">${Object.entries(PURPOSE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="col-md-auto"><label class="form-label small d-none d-md-block">&nbsp;</label><button class="btn btn-primary w-100">${icon('search', 'me-1')} Check credit</button></div>
        <div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" name="consent" id="consent" required><label class="form-check-label small" for="consent">The borrower has given written consent for this credit check.</label><div class="invalid-feedback">A credit check needs the borrower’s consent.</div></div>
          <div class="form-text">Every check is logged with your name, the purpose and the result, and is limited per day. Available to members in good standing.</div></div>
      </form></div></div>
    ${result}
    <div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('Customers', s.customers, `${s.openLoans} with open loans`, 'people', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Good scores', s.good, `${SCALE.good} and above`, 'hand-thumbs-up', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Bad scores', s.bad, `below ${SCALE.good}`, 'hand-thumbs-down', 'danger')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Average score', s.averageScore ?? '—', s.unscored ? `${s.unscored} not yet checked` : 'Of checked customers', 'speedometer2', 'info')}</div>
    </div>
    <div class="card mb-4"><div class="card-header bg-white d-flex flex-wrap gap-2 align-items-center">
      <h2 class="h6 mb-0 py-1 me-auto">Your customers</h2>
      <form class="d-flex" ${on('submit', 'setCQueryFrom', EL)}><input class="form-control form-control-sm" style="max-width:220px" type="search" name="q" maxlength="100" placeholder="Filter by name or NRC" value="${esc(CS.q)}"></form>
      <div class="d-flex gap-1">${chip('all', 'All')}${chip('good', 'Good')}${chip('bad', 'Bad')}</div>
    </div><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Customer</th><th>NRC</th><th class="text-end">Loan</th><th class="text-end">Balance</th><th>Status</th><th>Credit score</th><th></th></tr></thead><tbody>
      ${LOANS.map(c => `<tr><td><div class="fw-medium">${esc(c.borrowerName)}</div><div class="small text-body-secondary">Issued ${fmtDate(c.issuedAt)}</div></td><td class="small font-monospace">${esc(c.borrowerNrc)}</td>
        <td class="text-end">${K(c.amount)}</td><td class="text-end">${K(c.balance)}</td><td>${loanBadge(c.status)}</td><td>${scoreBadge(c.score, c.scoreRating)}</td>
        <td class="text-end text-nowrap"><button class="btn btn-sm btn-light" title="Edit" ${on('click', 'editLoan', c.id)}>${icon('pencil')}</button></td></tr>`).join('')
        || `<tr><td colspan="7">${empty(CS.q || CS.filter !== 'all' ? 'No customers match.' : 'No customers yet. Add the loans you have issued to see their credit scores here.', 'people')}</td></tr>`}
    </tbody></table></div></div>
    <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Credit check log</h2></div>
      <div class="table-responsive"><table class="table table-sm align-middle mb-0 small"><thead><tr><th>When</th><th>NRC</th><th>Purpose</th><th>Result</th></tr></thead><tbody>
      ${history.slice(0, 20).map(h => `<tr><td>${fmtDateTime(h.createdAt)}</td><td class="font-monospace">${esc(h.nrc)}</td><td>${esc(PURPOSE[h.purpose] || h.purpose)}</td><td>${h.found ? `Score ${Number(h.score)}` : 'No bureau record'}</td></tr>`).join('') || '<tr><td colspan="4" class="text-body-secondary">No checks yet.</td></tr>'}
      </tbody></table></div></div>`;
}
const setCFilter = k => { CS.filter = ['all', 'good', 'bad'].includes(k) ? k : 'all'; rerender(); };
const setCQuery = q => { CS.q = q; rerender(); };
const setCQueryFrom = form => setCQuery(form.q.value.trim());
const clearLookup = () => { LOOKUP = null; rerender(); };
async function searchNrc(form) {
  const v = readForm(form); if (!v) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Checking…');
  try {
    const r = await portal('/credit-checks', { method: 'POST', body: { nrc: v.nrc, purpose: v.purpose, consent: v.consent === true } });
    LOOKUP = { ...r, nrc: v.nrc };
    rerender();
  } catch (e) { busy(btn, false); fail(e); }
}
const loanFields = (l = {}) => `<div class="row g-3">
  <div class="col-md-6"><label class="form-label small fw-medium">Borrower name</label><input class="form-control" name="borrowerName" required maxlength="120" value="${esc(l.borrowerName || '')}"><div class="invalid-feedback">Required.</div></div>
  <div class="col-md-6"><label class="form-label small fw-medium">Borrower NRC</label><input class="form-control font-monospace" name="borrowerNrc" required ${NRC_ATTRS} value="${esc(l.borrowerNrc || '')}"><div class="invalid-feedback">e.g. 284512/11/1</div></div>
  <div class="col-md-6"><label class="form-label small fw-medium">Phone <span class="text-body-secondary fw-normal">(optional)</span></label><input class="form-control" name="borrowerPhone" maxlength="20" value="${esc(l.borrowerPhone || '')}"></div>
  <div class="col-md-6"><label class="form-label small fw-medium">Issued on</label><input class="form-control" type="date" name="issuedAt" max="${today()}" required value="${l.issuedAt ? esc(String(l.issuedAt).slice(0, 10)) : ''}"></div>
  <div class="col-md-4"><label class="form-label small fw-medium">Loan amount (K)</label><input class="form-control" type="number" name="amount" min="1" step="0.01" required value="${esc(l.amount ?? '')}"></div>
  <div class="col-md-4"><label class="form-label small fw-medium">Balance (K)</label><input class="form-control" type="number" name="balance" min="0" step="0.01" required value="${esc(l.balance ?? '')}"></div>
  <div class="col-md-4"><label class="form-label small fw-medium">Status</label><select class="form-select" name="status">${Object.entries(LOAN_STATUS).map(([k, [t]]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>`;
const loanBody = v => ({ ...v, amount: Number(v.amount), balance: Number(v.balance) });
function addLoan() {
  asyncModal({
    title: 'Add customer loan', confirmText: 'Add', size: 'lg', body: loanFields(),
    onSubmit: async v => { await portal('/loans', { method: 'POST', body: loanBody(v) }); done('Customer loan added. Run a credit check to see their score'); },
  });
}
function editLoan(id) {
  const l = LOANS.find(x => x.id === id); if (!l) return;
  const el = asyncModal({
    title: `Edit loan · ${esc(l.borrowerName)}`, confirmText: 'Save', size: 'lg', body: loanFields(l),
    onSubmit: async v => { await portal(`/loans/${encodeURIComponent(id)}`, { method: 'PATCH', body: loanBody(v) }); done('Loan updated'); },
  });
  const del = Object.assign(document.createElement('button'), { className: 'btn btn-outline-danger me-auto', type: 'button', textContent: 'Delete' });
  el.querySelector('.modal-footer').prepend(del);
  del.onclick = () => {
    el.close();
    setTimeout(() => asyncModal({
      title: 'Delete loan record', confirmText: 'Delete', tone: 'danger', body: `<p class="mb-0">Delete the loan record for <b>${esc(l.borrowerName)}</b>?</p>`,
      onSubmit: async () => { await portal(`/loans/${encodeURIComponent(id)}`, { method: 'DELETE' }); done('Loan deleted'); },
    }), 300);
  };
}

/* ================= ANNOUNCEMENTS & RESOURCES ================= */
async function announcements() {
  const [ann, res] = await Promise.all([portal('/announcements'), portal('/resources')]);
  const groups = res.reduce((g, r) => ((g[r.category] ||= []).push(r), g), {});
  return pageHeader('Announcements', 'Notices and resources from the MLAZ Secretariat')
    + `<div class="row g-3"><div class="col-lg-8"><div class="d-grid gap-3">${ann.map(a => `<div class="card"><div class="card-body"><div class="d-flex gap-2 align-items-center small text-body-secondary mb-1"><span class="badge bg-secondary-subtle text-secondary-emphasis">${esc(a.tag)}</span>${fmtDate(a.publishedAt)}</div><h2 class="h6 fw-semibold mb-1">${esc(a.title)}</h2><p class="small text-body-secondary mb-0" style="white-space:pre-line">${esc(a.body)}</p></div></div>`).join('') || empty('No announcements.')}</div></div>
    <div class="col-lg-4"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Resource library</h2></div><div class="list-group list-group-flush">
      ${Object.entries(groups).map(([cat, items]) => `<div class="list-group-item bg-body-tertiary small fw-semibold">${icon('folder2', 'me-1')}${esc(cat)}</div>`
        + items.map(r => `<div class="list-group-item d-flex align-items-center gap-2 small"><div class="flex-grow-1 min-w-0"><div class="fw-medium text-truncate">${esc(r.title)}</div><div class="text-body-secondary">${fmtDate(r.createdAt)}</div></div>
          <button class="btn btn-sm btn-light" title="Download" ${on('click', 'getFile', `/portal/resources/${encodeURIComponent(r.id)}/download`, EL)}>${icon('download')}</button></div>`).join('')).join('') || empty('No documents yet.', 'folder2')}
    </div></div></div></div>`;
}

/* ================= PROFILE ================= */
async function profile() {
  const m = await portal('/profile');
  const ro = (label, value) => `<div class="col-md-6"><label class="form-label small fw-medium">${label}</label><input class="form-control" disabled value="${esc(value)}"></div>`;
  const f = (name, label, type, attrs) => `<div class="col-md-6"><label class="form-label small fw-medium">${label}</label><input class="form-control" name="${name}" type="${type}" ${attrs} value="${esc(m[name] || '')}"><div class="invalid-feedback">Check this field.</div></div>`;
  return pageHeader('Business profile', 'Keep your contact details current')
    + `<div class="row g-3"><div class="col-lg-7"><div class="card"><div class="card-body p-4">
      <h2 class="h6 fw-semibold">Registered details</h2><p class="small text-body-secondary">These appear on your certificate and in the public directory. To change them, contact the Secretariat.</p>
      <div class="row g-3 mb-4">${ro('Business name', m.name)}${ro('Member number', m.number)}${ro('Town', `${m.town}, ${m.province}`)}${ro('Tier', m.tier)}${ro('ZRA TPIN', m.tpin)}${ro('PACRA no.', m.pacra || '—')}</div>
      <h2 class="h6 fw-semibold">Contact details</h2>
      <form class="row g-3" novalidate ${on('submit', 'saveProfile', EL)}>
        ${f('contactName', 'Contact person', 'text', 'required maxlength="120"')}${f('contactPhone', 'Phone', 'tel', 'required maxlength="20"')}${f('contactEmail', 'Contact email', 'email', 'required maxlength="200"')}
        <div class="col-12"><label class="form-label small fw-medium">Physical address</label><input class="form-control" name="address" maxlength="300" value="${esc(m.address || '')}"></div>
        <div class="col-12"><button class="btn btn-primary">Save changes</button></div>
      </form>
    </div></div></div>
    <div class="col-lg-5">${accountCard()}</div></div>`;
}
async function saveProfile(form) {
  const v = readForm(form); if (!v) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Saving…');
  try { await portal('/profile', { method: 'PATCH', body: v }); done('Contact details saved'); } catch (e) { busy(btn, false); fail(e); }
}

export const MEMBER_NAV = [
  ['My membership', [['overview', 'Overview', 'grid-1x2'], ['certificates', 'Certificates', 'award'], ['dues', 'Dues & payments', 'credit-card', () => (ME?.dues?.payable ? 1 : 0)]]],
  ['Lending', [['customers', 'Customers', 'people']]],
  ['Engage', [['events', 'Events', 'calendar-event'], ['announcements', 'Announcements', 'megaphone'], ['profile', 'Business profile', 'building']]],
];
export const MEMBER_PAGES = { overview, certificates, dues, customers, events, announcements, profile };
expose({
  getFile, submitProof, uploadRenewal, payDues, evQty, registerEvent, cancelReg,
  setCFilter, setCQueryFrom, clearLookup, searchNrc, addLoan, editLoan, saveProfile,
});

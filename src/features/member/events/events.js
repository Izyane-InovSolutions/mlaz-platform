import { publicConfig } from '../../../core/reference-data.js';
import { EL, expose, on } from '../../../core/events.js';
import { K, asyncModal, badge, busy, done, empty, esc, fail, fmtDate, icon, infoRow as row, note, pageHeader, safeUrl } from '../../../shared/ui/index.js';
import { EVENT_TYPE, checkoutForm, readCheckout } from '../../common/index.js';
import { portal } from '../shared/api.js';
import { bankTransferBlock, pollLater, startCheckout } from '../shared/payments.js';
import { ME } from '../shared/state.js';

const tix = n => `${Number(n)} ticket${n === 1 ? '' : 's'}`;

/* ================= EVENTS ================= */
const MAX_TICKETS = 10;
export async function events(id) {
  if (id) return eventPage(id);
  const list = await portal('/events');
  return pageHeader('Events', 'Register for MLAZ events')
    + `<div class="row g-3">${list.map(e => {
      const r = e.myRegistration, full = e.placesLeft <= 0, href = `#/app/events/${encodeURIComponent(e.id)}`;
      return `<div class="col-md-6 col-xl-4"><div class="card h-100"><div class="card-body d-flex flex-column">
        <div class="d-flex justify-content-between mb-2"><span class="badge bg-info-subtle text-info-emphasis">${esc(EVENT_TYPE[e.type] || e.type)}</span><span class="small text-body-secondary">${fmtDate(e.date)}</span></div>
        <h2 class="h6 fw-semibold mb-1">${esc(e.name)}</h2><div class="small text-body-secondary mb-2">${icon('geo-alt', 'me-1')}${esc(e.venue)} · ${Number(e.placesLeft)} place${e.placesLeft === 1 ? '' : 's'} left</div>
        <div class="small fw-semibold mb-3">${icon('ticket-perforated', 'me-1 text-primary')}${e.price ? `${K(e.price)} per ticket` : 'Free'}</div>
        <div class="mt-auto">${r ? `<a class="btn btn-sm w-100 ${r.status === 'PENDING' ? 'btn-outline-info' : 'btn-outline-success'}" href="${esc(safeUrl(href, 'self'))}">${r.status === 'PENDING' ? `${icon('hourglass-split', 'me-1')}Payment pending` : `${icon('check-lg', 'me-1')}Registered · ${tix(r.tickets)}`}</a>`
          : `<a class="btn btn-sm btn-primary w-100 ${full ? 'disabled' : ''}" href="${esc(safeUrl(href, 'self'))}">${full ? 'Fully booked' : 'Register'}</a>`}</div>
      </div></div></div>`; }).join('') || `<div class="col-12">${empty('No upcoming events.', 'calendar')}</div>`}</div>`;
}
let CUR_EVENT = null;
async function eventPage(id) {
  const [e, cfg] = await Promise.all([portal(`/events/${encodeURIComponent(id)}`), publicConfig()]);
  CUR_EVENT = e;
  const crumbs = `<li class="breadcrumb-item"><a href="#/app/events">Events</a></li><li class="breadcrumb-item active">${esc(e.name)}</li>`;
  const r = e.myRegistration, max = Math.min(Number(e.placesLeft), Number(e.maxTickets) || MAX_TICKETS);
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
      ${r.status === 'CONFIRMED' ? `<div class="d-flex gap-2 mt-3">${r.payment ? `<button class="btn btn-outline-secondary flex-grow-1" ${on('click', 'viewFile', `/portal/payments/${encodeURIComponent(r.payment.ref)}/receipt.pdf`, EL, `Receipt · ${r.payment.ref}`)}>${icon('receipt', 'me-1')} Receipt</button>` : ''}
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
      <div class="small text-body-secondary mt-1 mb-3">Up to ${tix(max)} per booking · ${Number(e.placesLeft)} places left</div>
      ${e.price ? `<div class="d-flex justify-content-between fw-semibold py-2 mb-3 border-top"><span>Total</span><span data-evtotal>${K(e.price)}</span></div>
      ${checkoutForm('evpay', { methods: cfg.paymentMethods, phone: ME?.contactPhone || '' })}
      <button class="btn btn-primary w-100 mt-3" ${on('click', 'registerEvent', EL)}>Pay and register</button>
      <div class="small text-body-secondary text-center mt-2">${icon('lock', 'me-1')}Secured payment · receipt emailed automatically</div>`
      : `<button class="btn btn-primary w-100" ${on('click', 'registerEvent', EL)}>Register</button>`}
    </div>`;
  }
  return pageHeader(esc(e.name), `${esc(EVENT_TYPE[e.type] || e.type)} · ${fmtDate(e.date)}`, '', crumbs)
    + `<div class="row g-3"><div class="col-lg-5"><div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Event details</h2></div><div class="card-body">
      ${row('Date', fmtDate(e.date))}${row('Venue', esc(e.venue))}${row('Type', esc(EVENT_TYPE[e.type] || e.type))}${row('Ticket price', e.price ? K(e.price) : 'Free')}${row('Places left', `${Number(e.placesLeft)} of ${Number(e.capacity)}`)}
      ${e.description ? `<p class="small mt-3 mb-0 pre-line">${esc(e.description)}</p>` : ''}
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

expose({ evQty, registerEvent, cancelReg });

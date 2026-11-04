import { can } from '../../../core/auth/permissions.js';
import { expose, on } from '../../../core/events.js';
import { rerender } from '../../../core/navigation.js';
import { K, asyncModal, busy, done, empty, esc, fail, fmtDate, icon, lower, modal, note, pageHeader, pctClass, toast, today } from '../../../shared/ui/index.js';
import { EVENT_TYPE } from '../../common/index.js';
import { adm } from '../shared/api.js';

/* ================= EVENTS ================= */
let EV_PAST = false;
const toggleEventsPast = () => { EV_PAST = !EV_PAST; rerender(); };
export async function events() {
  const list = await adm(`/events?past=${EV_PAST}`);
  return pageHeader('Events', 'AGMs, trainings and webinars for members',
    `<button class="btn btn-outline-secondary" ${on('click', 'toggleEventsPast')}>${EV_PAST ? 'Upcoming only' : 'Include past events'}</button>${can('events:write') ? `<button class="btn btn-primary" ${on('click', 'newEvent')}>${icon('plus-lg', 'me-1')} New event</button>` : ''}`)
    + `<div class="row g-3">${list.map(e => { const pct = Math.min(100, Math.round(e.registered / e.capacity * 100)) || 0; return `<div class="col-md-6 col-xl-4"><div class="card h-100 ${e.status === 'CANCELLED' ? 'opacity-75' : ''}"><div class="card-body d-flex flex-column">
      <div class="d-flex justify-content-between mb-2"><span class="badge bg-info-subtle text-info-emphasis">${esc(EVENT_TYPE[e.type] || e.type)}</span>${e.status === 'CANCELLED' ? '<span class="badge bg-danger-subtle text-danger-emphasis">Cancelled</span>' : `<span class="small text-body-secondary">${fmtDate(e.date)}</span>`}</div>
      <h2 class="h6 fw-semibold mb-1">${esc(e.name)}</h2><div class="small text-body-secondary mb-2">${icon('geo-alt', 'me-1')}${esc(e.venue)}</div>
      <div class="d-flex justify-content-between small mb-3"><span class="fw-semibold">${icon('ticket-perforated', 'me-1 text-primary')}${e.price ? `${K(e.price)} per ticket` : 'Free'}</span>${e.price ? `<span class="text-body-secondary">${K(e.revenue)} collected</span>` : ''}</div>
      <div class="mt-auto"><div class="d-flex justify-content-between small mb-1"><span>${Number(e.registered)} / ${Number(e.capacity)} registered</span><span class="text-body-secondary">${pct}%</span></div>
      <div class="progress progress-xs mb-3"><div class="progress-bar ${pctClass(pct)}"></div></div>
      <button class="btn btn-outline-secondary btn-sm w-100" ${on('click', 'manageEvent', e.id)}>Manage</button></div>
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
  try { e = await adm(`/events/${encodeURIComponent(id)}`); } catch (err) { return fail(err); }
  const row = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom"><span class="text-body-secondary">${k}</span><b>${v}</b></div>`;
  const editable = can('events:write') && e.status === 'PUBLISHED';
  const regStatus = r => r.status === 'PENDING' ? '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis">Payment pending</span>'
    : r.status === 'CONFIRMED' ? '<span class="badge rounded-pill bg-success-subtle text-success-emphasis">Confirmed</span>'
      : `<span class="badge rounded-pill bg-secondary-subtle text-secondary-emphasis">Cancelled</span>${r.refundDue ? ` <span class="badge rounded-pill bg-danger-subtle text-danger-emphasis">Refund due</span>${can('payments:record') ? ` <button class="btn btn-sm btn-outline-primary py-0" data-refund="${esc(r.id)}">Record refund</button>` : ''}` : r.refundedAt ? ` <span class="badge rounded-pill bg-success-subtle text-success-emphasis" title="${esc(`Ref ${r.refundRef} · ${r.refundedBy}`)}">Refunded</span>` : ''}`;
  const el = modal({
    title: esc(e.name), size: 'lg',
    body: `${e.status === 'CANCELLED' ? note('danger', 'x-octagon', `<b>Cancelled.</b> ${esc(e.cancelReason || '')}`) : ''}
      <div class="small mb-3">${row('Date', fmtDate(e.date))}${row('Venue', esc(e.venue))}${row('Registrations', `${Number(e.registered)} / ${Number(e.capacity)}`)}${row('Revenue collected', K(e.revenue))}</div>
      ${editable ? `<form class="row g-2 align-items-end mb-4" novalidate data-edit>
        <div class="col-sm-5"><label class="form-label small fw-medium">Price per ticket (K)</label><input class="form-control" type="number" name="price" min="0" step="1" value="${Number(e.price)}" required></div>
        <div class="col-sm-4"><label class="form-label small fw-medium">Capacity</label><input class="form-control" type="number" name="capacity" min="${Math.max(1, Number(e.registered) || 0)}" value="${Number(e.capacity)}" required><div class="invalid-feedback">At least ${Math.max(1, Number(e.registered) || 0)}.</div></div>
        <div class="col-sm-3"><button class="btn btn-outline-primary w-100">Save</button></div>
        <div class="col-12 form-text">Price changes apply to new registrations only.</div></form>` : ''}
      <div class="small fw-semibold mb-2">Registrations</div>
      <div class="table-responsive"><table class="table table-sm small align-middle mb-0"><thead><tr><th>Member</th><th class="text-end">Tickets</th><th class="text-end">Amount</th><th>Payment</th><th>Status</th></tr></thead><tbody>
      ${e.registrations.map(r => `<tr><td><a href="#/app/members/${esc(r.member.number)}">${esc(r.member.name)}</a></td><td class="text-end">${Number(r.tickets)}</td><td class="text-end">${r.amount ? K(r.amount) : 'Free'}</td><td class="small">${r.payment ? `${esc(r.payment.ref)} · ${esc(lower(r.payment.status))}` : '—'}</td><td>${regStatus(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-body-secondary">No registrations yet.</td></tr>'}
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
    try { await adm(`/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: { price: Number(form.price.value), capacity: Number(form.capacity.value) } }); el.close(); done('Event updated'); } catch (err) { busy(btn, false); fail(err); }
  };
  el.querySelector('[data-cancel]')?.addEventListener('click', () => {
    const paid = e.registrations.filter(r => r.status === 'CONFIRMED' && r.amount);
    el.close();
    setTimeout(() => asyncModal({
      title: 'Cancel event', confirmText: 'Cancel event', tone: 'danger',
      body: `<p>Cancel <b>${esc(e.name)}</b>? Registered members will be notified.</p>${paid.length ? note('warning', 'exclamation-triangle', `${paid.length} paid registration(s) will be flagged for refund.`) : ''}
        <label class="form-label small fw-medium">Reason (sent to members)</label><textarea class="form-control" name="reason" rows="2" required></textarea><div class="invalid-feedback">Give a reason.</div>`,
      onSubmit: async v => { await adm(`/events/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: v }); done('Event cancelled; members have been told'); },
    }), 300);
  });
}

expose({ toggleEventsPast, newEvent, manageEvent });

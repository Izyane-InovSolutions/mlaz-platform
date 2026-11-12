import { publicConfig } from '../../../core/reference-data.js';
import { EL, expose, on } from '../../../core/events.js';
import { K, empty, esc, fmtDate, icon, infoRow as row, lower, note, pageHeader } from '../../../shared/ui/index.js';
import { checkoutForm, payBadge, readCheckout } from '../../common/index.js';
import { portal } from '../shared/api.js';
import { bankTransferBlock, pollLater, startCheckout } from '../shared/payments.js';
import { ME } from '../shared/state.js';

/* ================= DUES & PAYMENTS ================= */
export async function dues() {
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
        <td class="text-end">${x.status === 'SUCCESS' ? `<button class="btn btn-sm btn-light" title="Receipt" ${on('click', 'viewFile', `/portal/payments/${encodeURIComponent(x.ref)}/receipt.pdf`, EL, `Receipt · ${x.ref}`)}>${icon('receipt')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6">${empty('No payments yet.', 'credit-card')}</td></tr>`}
      </tbody></table></div></div></div></div>`;
}
function payDues(btn) {
  const checkout = readCheckout('duespay'); if (!checkout) return;
  startCheckout(() => portal('/dues/payments', { method: 'POST', body: checkout }), btn);
}

expose({ payDues });

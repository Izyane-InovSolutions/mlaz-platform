import { api } from '../../../core/api/client.js';
import { can } from '../../../core/auth/permissions.js';
import { EL, expose, on } from '../../../core/events.js';
import { rerender } from '../../../core/navigation.js';
import { K, KM, asyncModal, busy, done, empty, esc, fail, fmtDate, fmtDateTime, icon, lower, modal, note, pageHeader, pager, safeFilename, safeUrl, statCard, tableCard, today } from '../../../shared/ui/index.js';
import { documentPreview, documentUrl, mountPreview, payBadge } from '../../common/index.js';
import { adm, qs } from '../shared/api.js';
import { listToolbar, paymentRow } from '../shared/ui.js';

/* ================= PAYMENTS & EXPENSES ================= */
const PTABS = [['', 'All'], ['review', 'Awaiting review'], ['PENDING', 'Pending'], ['SUCCESS', 'Successful'], ['FAILED', 'Failed']];
let PS = { tab: '', q: '', page: 1 };
const setPTab = k => { PS = { ...PS, tab: k, page: 1 }; rerender(); };
const setPQuery = q => { PS = { ...PS, q, page: 1 }; rerender(); };
const setPPage = p => { PS.page = p; rerender(); };
let EXPENSES = [];

export async function payments() {
  const canExp = can('expenses:read');
  const [s, list, exp] = await Promise.all([
    adm('/payments/summary'),
    adm(`/payments${qs({ status: PS.tab === 'review' ? '' : PS.tab, awaitingReview: PS.tab === 'review' ? 'true' : '', q: PS.q, page: PS.page, pageSize: 20 })}`),
    canExp ? adm('/expenses') : null,
  ]);
  EXPENSES = exp?.items || [];
  const expensesCard = canExp ? `<div class="card"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1 me-auto">Expenses</h2>${can('expenses:write') ? `<button class="btn btn-sm btn-primary" ${on('click', 'addExpense')}>${icon('plus-lg', 'me-1')} Add expense</button>` : ''}</div>
      <div class="table-responsive mh-520"><table class="table table-sm table-hover align-middle small mb-0"><thead class="sticky-top"><tr><th>Expense</th><th class="text-end">Amount</th><th></th></tr></thead><tbody>
      ${EXPENSES.map(x => `<tr><td><div class="fw-medium">${esc(x.description)}</div><div class="text-body-secondary">${esc(x.category)} · ${esc(x.payee)} · ${fmtDate(x.date)}</div>${x.event ? `<div class="text-body-secondary">${icon('calendar-event', 'me-1')}${esc(x.event.name)}</div>` : ''}</td>
        <td class="text-end fw-medium text-nowrap">${K(x.amount)}</td><td class="text-end"><button class="btn btn-sm btn-light" title="Details" ${on('click', 'viewExpense', x.ref)}>${icon('three-dots')}</button></td></tr>`).join('') || `<tr><td colspan="3">${empty('No expenses recorded.', 'wallet2')}</td></tr>`}
      </tbody>${EXPENSES.length ? `<tfoot><tr class="fw-semibold"><td>Total</td><td class="text-end text-nowrap">${K(exp.total)}</td><td></td></tr></tfoot>` : ''}</table></div></div>` : '';
  return pageHeader('Payments & dues', 'Joining fees, annual dues and event tickets across mobile money, card and bank',
    `${can('payments:confirm') ? `<button class="btn btn-outline-secondary" ${on('click', 'reconcile', EL)}>${icon('arrow-repeat', 'me-1')} Reconcile</button>` : ''}${can('comms:write') ? `<button class="btn btn-primary" ${on('click', 'broadcast', 'DUES_DUE')}>${icon('envelope', 'me-1')} Send dues reminders</button>` : ''}`)
    + `<div class="row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xxl-5 g-3 mb-4">
      <div class="col">${statCard('Collected (YTD)', KM(s.collectedYtd), 'successful payments this year', 'cash-stack', 'primary')}</div>
      <div class="col">${statCard('Collected today', K(s.collectedToday), `${Number(s.transactionsToday)} transaction${s.transactionsToday === 1 ? '' : 's'}`, 'graph-up-arrow', 'success')}</div>
      <div class="col">${statCard('Dues due', Number(s.duesDue), 'members', 'hourglass-split', 'warning')}</div>
      <div class="col">${statCard('Via mobile money', `${Number(s.mobileMoneyShare)}%`, 'of payments this year', 'phone', 'info')}</div>
      ${canExp ? `<div class="col">${statCard('Expenses (YTD)', KM(s.expensesYtd), `${Number(s.expensesCount)} recorded · ${K(s.expensesThisMonth)} this month`, 'wallet2', 'danger')}</div>` : ''}
    </div>
    <div class="row g-3"><div class="col-xl-8">`
    + tableCard(['Reference', 'Payer', 'Description', 'Method', '#Amount', 'Status', '#'], list.items.map(p => paymentRow(p)).join(''), 'No payments here.', pager(list, 'setPPage'),
      listToolbar({ filters: PTABS, active: PS.tab, filterFn: 'setPTab', label: 'Show', q: PS.q, searchFn: 'setPQuery', placeholder: 'Search by reference, payer or bank reference' }))
    + `</div><div class="col-xl-4">${expensesCard}</div></div>`;
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
  let url = null, file = null, doc = `<div class="border rounded p-4 text-center text-body-secondary small">${icon('file-earmark', 'fs-2 d-block mb-2')}No proof of payment uploaded</div>`;
  if (p.proofDocumentId && can('documents:read')) {
    try {
      const d = documentUrl(await (await api(`/admin/documents/${encodeURIComponent(p.proofDocumentId)}`, { raw: true })).blob());
      url = d.url; file = d;
      doc = documentPreview(d, 'Proof of payment', 'h-60vh');
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
    footer: `${url ? `<a class="btn btn-light me-auto" href="${esc(safeUrl(url, 'blob'))}" download="${esc(safeFilename(`proof-${p.ref}`))}">${icon('download', 'me-1')} Download</a>` : ''}<button class="btn btn-light" data-bs-dismiss="modal">Close</button>
      ${reviewable ? `<button class="btn btn-outline-danger" data-reject>Reject</button><button class="btn btn-primary" data-confirm>${icon('check-lg', 'me-1')} Confirm payment</button>` : ''}`,
  });
  if (file) mountPreview(el, file, 'Proof of payment');
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
      <div class="col-12"><label class="form-label small fw-medium">Event <span class="text-body-secondary fw-normal">(optional)</span></label><select class="form-select" name="eventId"><option value="">Not linked to an event</option>${evs.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></div>
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

expose({ setPTab, setPQuery, setPPage, reconcile, reviewPayment, addExpense, viewExpense });

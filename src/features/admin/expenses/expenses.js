import { can } from '../../../core/auth/permissions.js';
import { expose, on } from '../../../core/events.js';
import { rerender } from '../../../core/navigation.js';
import { K, KM, asyncModal, done, empty, esc, fail, fmtDate, icon, modal, pageHeader, statCard, today } from '../../../shared/ui/index.js';
import { adm } from '../shared/api.js';
import { listToolbar } from '../shared/ui.js';

let EXPENSES = [];
let ES = { method: '', q: '' };
const setEMethod = method => { ES = { ...ES, method }; rerender(); };
const setEQuery = q => { ES = { ...ES, q }; rerender(); };

export async function expenses() {
  const result = await adm('/expenses');
  EXPENSES = result.items;
  const methods = [['Bank transfer', 'bank'], ['Card', 'credit-card'], ['Mobile money', 'phone'], ['Cash', 'cash']];
  const filtered = EXPENSES.filter(x => (!ES.method || x.method === ES.method)
    && (!ES.q || [x.ref, x.description, x.payee, x.category, x.method, x.event?.name].some(value => value?.toLowerCase().includes(ES.q.toLowerCase()))));
  const methodTotals = Object.fromEntries(methods.map(([method]) => [
    method,
    EXPENSES.filter(expense => expense.method === method).reduce((total, expense) => total + Number(expense.amount), 0),
  ]));
  const filteredTotal = filtered.reduce((total, expense) => total + Number(expense.amount), 0);
  return pageHeader('Expenses', 'Record and review association spending',
    `${can('expenses:write') ? `<button class="btn btn-primary" ${on('click', 'addExpense')}>${icon('plus-lg', 'me-1')} Add expense</button>` : ''}`)
    + `<div class="row row-cols-1 row-cols-sm-2 row-cols-xl-5 g-3 mb-4">
      <div class="col">${statCard('Total expenses', KM(result.total), `${EXPENSES.length} recorded`, 'wallet2', 'danger')}</div>
      ${methods.map(([method, methodIcon]) => `<div class="col">${statCard(`${method} expenses`, KM(methodTotals[method]), '', methodIcon, 'primary')}</div>`).join('')}
    </div>
    <div class="card">${listToolbar({
      filters: [['', 'All'], ...methods.map(([method]) => [method, method])],
      active: ES.method, filterFn: 'setEMethod', label: 'Show',
      q: ES.q, searchFn: 'setEQuery', placeholder: 'Search by description, payee, category or reference',
    })}<div class="table-responsive"><table class="table table-sm table-hover align-middle small mb-0">
      <thead><tr><th>Expense</th><th>Paid to</th><th>Category</th><th>Date paid</th><th>Method</th><th class="text-end">Amount</th><th></th></tr></thead>
      <tbody>${filtered.map(x => `<tr>
        <td><div class="fw-medium">${esc(x.description)}</div>${x.event ? `<div class="text-body-secondary">${icon('calendar-event', 'me-1')}${esc(x.event.name)}</div>` : ''}</td>
        <td>${esc(x.payee)}</td><td>${esc(x.category)}</td><td class="text-nowrap">${fmtDate(x.date)}</td><td>${esc(x.method)}</td>
        <td class="text-end fw-medium text-nowrap">${K(x.amount)}</td>
        <td class="text-end"><button class="btn btn-sm btn-light" title="Details" ${on('click', 'viewExpense', x.ref)}>${icon('three-dots')}</button></td>
      </tr>`).join('') || `<tr><td colspan="7">${empty(ES.q || ES.method ? 'No expenses match your search or filter.' : 'No expenses recorded.', 'wallet2')}</td></tr>`}</tbody>
      ${filtered.length ? `<tfoot><tr class="fw-semibold"><td colspan="5">Total</td><td class="text-end text-nowrap">${K(filteredTotal)}</td><td></td></tr></tfoot>` : ''}
    </table></div></div>`;
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

expose({ addExpense, viewExpense, setEMethod, setEQuery });

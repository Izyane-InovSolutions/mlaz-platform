import { EL, expose, on } from '../../../core/events.js';
import { rerender } from '../../../core/navigation.js';
import { K, NRC_ATTRS, asyncModal, badge, busy, done, empty, esc, fail, fmtDate, fmtDateTime, icon, infoRow as row, note, pageHeader, pctClass, readForm, statCard, today } from '../../../shared/ui/index.js';
import { portal } from '../shared/api.js';

/* ================= CUSTOMERS & CREDIT CHECKS ================= */
let CS = { filter: 'all', q: '' }, LOOKUP = null, SCALE = { min: 300, max: 850, good: 600 }, LOANS = [];
const LOAN_STATUS = { CURRENT: ['Current', 'success'], ARREARS: ['In arrears', 'danger'], CLOSED: ['Closed', 'secondary'] };
const loanBadge = s => { const [t, tone] = LOAN_STATUS[s] || [s, 'secondary']; return badge(esc(t), tone); };
const scoreBadge = (s, rating) => s == null ? '<span class="small text-body-secondary">Not checked</span>' : badge(`${Number(s)} · ${rating === 'GOOD' ? 'Good' : 'Bad'}`, rating === 'GOOD' ? 'success' : 'danger');
const PURPOSE = { NEW_LOAN: 'Assessing a new loan', LOAN_REVIEW: 'Reviewing an existing loan', COLLECTIONS: 'Collections on an overdue loan' };
const ageOf = dob => Math.floor((Date.now() - new Date(dob)) / 3.15576e10);

function creditReport(c) {
  const good = c.rating === 'GOOD', pct = Math.round((c.score - SCALE.min) / (SCALE.max - SCALE.min) * 100);
  return `<div class="row g-4"><div class="col-md-5">
      <div class="text-center border rounded p-3 mb-3">
        <div class="small text-body-secondary">Credit score</div>
        <div class="display-5 fw-semibold text-${good ? 'success' : 'danger'}-emphasis">${Number(c.score)}</div>
        <div class="mb-2">${scoreBadge(c.score, c.rating)}</div>
        <div class="progress progress-xs" role="progressbar" aria-label="Score" aria-valuenow="${Number(c.score)}" aria-valuemin="${Number(SCALE.min)}" aria-valuemax="${Number(SCALE.max)}"><div class="progress-bar bg-${good ? 'success' : 'danger'} ${pctClass(pct)}"></div></div>
        <div class="d-flex justify-content-between small text-body-secondary mt-1"><span>${Number(SCALE.min)}</span><span>${Number(SCALE.good)}+ good</span><span>${Number(SCALE.max)}</span></div>
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

export async function customers() {
  const [r, history] = await Promise.all([portal(`/loans?${new URLSearchParams({ filter: CS.filter, ...(CS.q && { q: CS.q }) })}`), portal('/credit-checks')]);
  LOANS = r.items; SCALE = r.scale;
  const s = r.summary;
  const chip = (k, label) => `<button class="btn btn-sm ${CS.filter === k ? 'btn-primary' : 'btn-outline-secondary'}" ${on('click', 'setCFilter', k)}>${label}</button>`;
  const result = !LOOKUP ? '' : LOOKUP.found
    ? `<div class="card mb-4 border-primary-subtle"><div class="card-header bg-white d-flex align-items-center"><h2 class="h6 mb-0 py-1">Credit report · ${esc(LOOKUP.report.name)}</h2>${LOOKUP.yourLoans.length ? '<span class="badge bg-primary-subtle text-primary-emphasis ms-2">Your customer</span>' : ''}<button class="btn-close ms-auto" aria-label="Close" ${on('click', 'clearLookup')}></button></div>
        <div class="card-body">${LOOKUP.simulated ? note('warning', 'exclamation-triangle', '<b>Simulated report.</b> No credit bureau is connected on this site: this report is invented test data, not a real borrower\'s record. Do not use it for a lending decision.') : ''}${creditReport(LOOKUP.report)}<div class="small text-body-secondary mt-3">${icon('info-circle', 'me-1')}Check logged with your name and the purpose you gave. ${Number(LOOKUP.checksLeftToday)} check${LOOKUP.checksLeftToday === 1 ? '' : 's'} left today.</div></div></div>`
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
      <div class="col-sm-6 col-xl-3">${statCard('Customers', Number(s.customers), `${Number(s.openLoans)} with open loans`, 'people', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Good scores', Number(s.good), `${Number(SCALE.good)} and above`, 'hand-thumbs-up', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Bad scores', Number(s.bad), `below ${Number(SCALE.good)}`, 'hand-thumbs-down', 'danger')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Average score', s.averageScore == null ? '—' : Number(s.averageScore), s.unscored ? `${Number(s.unscored)} not yet checked` : 'Of checked customers', 'speedometer2', 'info')}</div>
    </div>
    <div class="card mb-4"><div class="card-header bg-white d-flex flex-wrap gap-2 align-items-center">
      <h2 class="h6 mb-0 py-1 me-auto">Your customers</h2>
      <form class="d-flex" ${on('submit', 'setCQueryFrom', EL)}><input class="form-control form-control-sm mw-220" type="search" name="q" maxlength="100" aria-label="Filter customers by name or NRC" placeholder="Filter by name or NRC" value="${esc(CS.q)}"></form>
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

expose({ setCFilter, setCQueryFrom, clearLookup, searchNrc, addLoan, editLoan });

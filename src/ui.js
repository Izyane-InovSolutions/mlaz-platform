import { Modal, Toast } from 'bootstrap';
import QRCode from 'qrcode';
import { load, save, reset, nextId as seqId, saveDoc, getDoc, deleteDoc } from './store.js';

/* ================= STATE ================= */
export const S = load();
export const commit = () => save(S);
export const nextId = (kind, prefix) => seqId(S, kind, prefix);
export const resetData = reset;
export { saveDoc, getDoc, deleteDoc };

// Figures for the ~605 members that exist outside this prototype slice, so headline numbers stay realistic.
const BASE = { members: 605, accredited: 543, duesOutstanding: 72, collected: 2448000, Gold: 210, Silver: 283, Bronze: 110 };
const BASE_REGIONS = { Lusaka: 228, Copperbelt: 162, Southern: 58, Central: 41, Eastern: 34, 'North-Western': 29, Northern: 21, Luapula: 13, Muchinga: 10, Western: 9 };
export const TIERDUES = { Bronze: 1800, Silver: 3000, Gold: 4500 };
export const JOINING_FEE = 2000;

/* ================= FORMATTING ================= */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const initials = s => String(s).split(' ').map(w => w[0]).filter(x => /[A-Za-z]/.test(x || '')).slice(0, 2).join('').toUpperCase();
export const K = n => 'K' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const KM = n => n >= 1e6 ? 'K' + (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? 'K' + Math.round(n / 1000) + 'k' : K(n);
export const today = () => new Date().toISOString().slice(0, 10);
export const nowLabel = () => 'Today ' + new Date().toTimeString().slice(0, 5);
export const plusYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
export const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDateTime = d => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const nextYear = () => new Date().getFullYear() + 1;
const AVA = ['#0b5e3b', '#1e5ba8', '#b7791f', '#7c3aed', '#0e8a89', '#c2410c', '#0b2e59', '#15803d'];
export const avatar = (name, i, lg) => `<span class="avatar ${lg ? 'lg' : ''}" style="background:${AVA[i % AVA.length]}">${esc(initials(name))}</span>`;

/* ================= DOMAIN ================= */
export const memberById = id => S.members.find(m => m.id === id);
export const appById = id => S.apps.find(a => a.id === id);
export const eventByName = name => S.events.find(e => e.name === name);
export const ticketPrice = e => +e.price || 0;
export const priceLabel = e => ticketPrice(e) ? `${K(ticketPrice(e))} per ticket` : 'Free';
export const tix = n => `${n} ticket${n === 1 ? '' : 's'}`;
export const inGoodStanding = m => m.status === 'active' && m.accred === 'issued';
export const certNo = m => `MLAZ/ACC/${m.id.split('-')[1]}/${String(new Date(m.expiry).getFullYear() - 1).slice(2)}`;
export const log = (memberId, icon, tone, title, sub) => { const m = memberById(memberId); if (m) (m.activity ||= []).unshift({ icon, tone, title, sub }); };
export function addPayment(member, type, amt, method, status = 'success', extra = {}) {
  const ref = nextId('pay', 'PAY-');
  S.payments.unshift({ ref, member, type, amt, method, date: nowLabel(), at: new Date().toISOString(), status, ...extra });
  return ref;
}

/* Secretariat staff. Two demo users so maker-checker can be shown: one recommends, the other approves. */
export const STAFF = {
  'secretariat@mlaz.org.zm': { name: 'Grace Mwansa', title: 'Secretariat Admin' },
  'officer@mlaz.org.zm': { name: 'John Phiri', title: 'Membership Officer' },
};
export const staffFor = email => STAFF[email] || { name: email.split('@')[0], title: 'Secretariat staff' };
export const currentStaff = () => { const s = getSession(); return s?.role === 'admin' ? { ...staffFor(s.email), email: s.email } : null; };

/* Audit trail: every decision is recorded with who made it and when. `by` defaults to the signed-in staff member. */
export function audit(target, action, note = '', by) {
  const st = currentStaff();
  (S.audit ||= []).unshift({ at: new Date().toISOString(), by: by || (st ? `${st.name} (${st.title})` : 'System'), target, action, note });
}

/* Issues accreditation as soon as an application is verified and paid: creates the member and their certificate. */
export function accredit(a) {
  const id = nextId('member', 'MLA-');
  S.members.push({
    id, name: a.name, town: a.town, province: a.province, tier: a.tier, status: 'active', mof: 'valid', mofRef: a.mofRef, accred: 'issued', duesPaid: true,
    expiry: plusYear(), contact: a.contact, phone: a.phone, email: a.email || '', joined: today(), pacra: a.pacra, tpin: a.tpin,
    activity: [{ icon: 'award', tone: 'success', title: 'Accreditation issued', sub: `Certificate generated automatically ${fmtDate(new Date())}` }, { icon: 'credit-card', tone: 'warning', title: 'Joining fee and dues paid', sub: K(JOINING_FEE + TIERDUES[a.tier]) }],
  });
  a.stage = 'accredited'; a.memberId = id;
  audit(a.id, 'Accreditation issued', `Member ${id} · certificate generated automatically on payment`, 'System');
  return id;
}
export function totals() {
  const totalMembers = BASE.members + S.members.length;
  const accredited = BASE.accredited + S.members.filter(inGoodStanding).length;
  const outstanding = BASE.duesOutstanding + S.members.filter(m => !m.duesPaid).length;
  const collected = BASE.collected + S.payments.filter(p => p.status === 'success').reduce((a, p) => a + p.amt, 0);
  const tiers = { Gold: BASE.Gold, Silver: BASE.Silver, Bronze: BASE.Bronze };
  S.members.forEach(m => tiers[m.tier]++);
  const regions = { ...BASE_REGIONS };
  S.members.forEach(m => { if (m.province) regions[m.province] = (regions[m.province] || 0) + 1; });
  return { totalMembers, accredited, outstanding, collected, tiers, regions };
}
export const counts = () => ({
  open: S.apps.filter(a => a.stage !== 'accredited').length,
  mofReview: S.apps.filter(a => a.stage === 'mof_review').length + S.members.filter(m => m.mofRenewalPending).length,
  awaitingPayment: S.apps.filter(a => a.stage === 'payment_pending').length,
});
export function findMember(q) {
  const ql = String(q || '').trim().toLowerCase();
  if (!ql) return null;
  return S.members.find(x => x.id.toLowerCase() === ql) || S.members.find(x => x.name.toLowerCase().includes(ql));
}

/* ================= SESSION & ROUTING ================= */
const SKEY = 'mlaz-session';
export function getSession() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } }
export function setSession(s) { try { s ? sessionStorage.setItem(SKEY, JSON.stringify(s)) : sessionStorage.removeItem(SKEY); } catch (e) { /* ignore */ } }
let renderer = () => {};
export const setRenderer = f => { renderer = f; };
export const rerender = () => renderer();
export const nav = path => { const h = '#/' + path; if (location.hash === h) rerender(); else location.hash = h; };
const queue = [];
export const after = fn => queue.push(fn);
export const flushAfter = () => { while (queue.length) queue.shift()(); };
export const expose = o => Object.assign(window, o);

/* ================= UI PRIMITIVES ================= */
export const icon = (n, cls = '') => `<i class="bi bi-${n} ${cls}"></i>`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const pill = (text, tone) => `<span class="badge rounded-pill bg-${tone}-subtle text-${tone}-emphasis border border-${tone}-subtle">${text}</span>`;
export const statusBadge = s => pill(cap(s), { active: 'success', lapsed: 'warning', suspended: 'danger' }[s] || 'secondary');
export const tierBadge = t => `<span class="badge rounded-pill tier tier-${t}">${t}</span>`;
export const accredBadge = a => pill(cap(a), { issued: 'success', expired: 'warning', revoked: 'danger' }[a] || 'secondary');
export const mofBadge = s => pill(cap(s), s === 'valid' ? 'success' : 'danger');
export const duesBadge = paid => paid ? pill('Paid', 'success') : pill('Outstanding', 'warning');
export const STAGES = {
  details: ['Awaiting documents', 'secondary'], mof_review: ['MoF review', 'warning'], mof_approval: ['Awaiting approval', 'primary'],
  payment_pending: ['Payment pending', 'info'], accredited: ['Accredited', 'success'],
};
export const stageBadge = s => { const [t, tone] = STAGES[s] || ['Unknown', 'secondary']; return pill(t, tone); };
// Secretariat view: a recommended application is waiting on the checker, not the maker.
export const appBadge = a => stageBadge(a.stage === 'mof_review' && a.recommendation ? 'mof_approval' : a.stage);
export const payBadge = s => pill(cap(s), { success: 'success', pending: 'warning', failed: 'danger' }[s]);

export const pageHeader = (title, sub, actions = '', crumbs = '') => `
  ${crumbs ? `<nav aria-label="breadcrumb"><ol class="breadcrumb small mb-2">${crumbs}</ol></nav>` : ''}
  <div class="d-flex flex-wrap align-items-start gap-3 mb-4">
    <div class="me-auto"><h1 class="h3 mb-1">${title}</h1>${sub ? `<p class="text-body-secondary mb-0">${sub}</p>` : ''}</div>
    ${actions ? `<div class="d-flex flex-wrap gap-2">${actions}</div>` : ''}
  </div>`;

export const statCard = (label, value, sub, ic, tone = 'primary') => `
  <div class="card h-100"><div class="card-body"><div class="d-flex justify-content-between gap-2">
    <div><div class="small text-body-secondary fw-medium">${label}</div><div class="${String(value).startsWith('<span') ? 'fs-6 mt-2 mb-1' : 'fs-3 fw-semibold mt-1 lh-sm'}">${value}</div>${sub ? `<div class="small text-body-secondary mt-1">${sub}</div>` : ''}</div>
    <div class="stat-icon bg-${tone}-subtle text-${tone}-emphasis">${icon(ic)}</div>
  </div></div></div>`;

export const stepper = (steps, idx) => `<ol class="stepper">${steps.map((s, i) =>
  `<li class="${i < idx ? 'done' : i === idx ? 'active' : ''}"><span class="dot">${i < idx ? icon('check-lg') : i + 1}</span><span class="label">${s}</span></li>`).join('')}</ol>`;

export const empty = (text, ic = 'inbox') => `<div class="text-center text-body-secondary py-5">${icon(ic, 'fs-2 d-block mb-2 opacity-50')}<div class="small">${text}</div></div>`;

export const listItem = (ic, tone, title, sub, right = '') => `
  <div class="list-group-item d-flex align-items-center gap-3 py-3">
    <span class="icon-circle bg-${tone}-subtle text-${tone}-emphasis">${icon(ic)}</span>
    <div class="flex-grow-1 min-w-0"><div class="fw-medium">${title}</div>${sub ? `<div class="small text-body-secondary">${sub}</div>` : ''}</div>
    ${right}
  </div>`;

export function toast(msg, variant = 'success') {
  const el = document.createElement('div');
  el.className = `toast align-items-center border-0 ${variant === 'error' ? 'text-bg-danger' : 'text-bg-dark'}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${icon(variant === 'error' ? 'exclamation-circle' : 'check-circle-fill', 'me-2')}${esc(msg)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  document.getElementById('toasts').appendChild(el);
  el.addEventListener('hidden.bs.toast', () => el.remove());
  new Toast(el, { delay: 3500 }).show();
}

export function modal({ title, body, footer = '', size = '' }) {
  const el = document.createElement('div');
  el.className = 'modal fade'; el.tabIndex = -1;
  el.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size ? 'modal-' + size : ''}"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">${title}</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
    <div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div></div>`;
  document.body.appendChild(el);
  const m = new Modal(el);
  el.addEventListener('hidden.bs.modal', () => { m.dispose(); el.remove(); });
  m.show();
  el.close = () => m.hide();
  return el;
}
export const closeModal = btn => Modal.getInstance(btn.closest('.modal'))?.hide();
export function closeAllModals() { document.querySelectorAll('.modal.show').forEach(el => Modal.getInstance(el)?.hide()); }

export function confirmModal({ title, body, confirmText = 'Confirm', tone = 'primary', onConfirm }) {
  const el = modal({ title, body, footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button class="btn btn-${tone}" data-ok>${confirmText}</button>` });
  el.querySelector('[data-ok]').onclick = () => { if (onConfirm(el) !== false) el.close(); };
  return el;
}

/* reads [name] fields inside root; flags invalid ones; returns null if anything is invalid */
export function readForm(root) {
  const out = {}; let ok = true;
  root.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'file') { out[el.name] = el.files[0]?.name || ''; }
    else if (el.type === 'checkbox') { out[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; return; }
    else out[el.name] = el.value.trim();
    const bad = !el.checkValidity() || (el.required && el.type !== 'checkbox' && !out[el.name]);
    el.classList.toggle('is-invalid', bad); if (bad) ok = false;
  });
  return ok ? out : null;
}

/* ================= PAYMENTS (mobile money / card) ================= */
export const PAY_METHODS = ['MTN Mobile Money', 'Airtel Money', 'Zamtel Kwacha', 'iZyane Pay QR', 'Visa / Mastercard', 'Bank transfer'];
export const isQr = method => /QR/.test(method);
const isCard = method => /Visa/.test(method), isBank = method => /Bank/.test(method);
// MLAZ collection account shown to members paying by bank transfer (demo details).
export const BANK = { bank: 'Zambia National Commercial Bank (Zanaco)', name: 'Money Lenders Association of Zambia', number: '0123 4567 8901', branch: 'Cairo Road, Lusaka' };

/* Payment form whose fields follow the chosen method: phone for mobile money, card details, bank details with proof of payment, or nothing for QR. */
const payInput = (name, label, attrs = '', col = 'col-12', err = 'Required.') => `<div class="${col}"><label class="form-label small fw-medium">${label}</label><input class="form-control" name="${name}" ${attrs} required><div class="invalid-feedback">${err}</div></div>`;
function payFields(method, o) {
  if (isQr(method)) return `<div class="alert alert-light border small d-flex gap-2 mb-0">${icon('qr-code')}<div>You’ll be shown a QR code to scan with your banking or mobile money app.</div></div>`;
  if (isCard(method)) return `<div class="row g-2">${payInput('cardName', 'Name on card', 'autocomplete="cc-name"')}
      ${payInput('cardNumber', 'Card number', 'inputmode="numeric" autocomplete="cc-number" pattern="[0-9 ]{13,23}" placeholder="0000 0000 0000 0000"', 'col-12', 'Enter a valid card number.')}
      ${payInput('cardExp', 'Expiry', 'autocomplete="cc-exp" pattern="(0[1-9]|1[0-2])/[0-9]{2}" placeholder="MM/YY"', 'col-6', 'Use MM/YY.')}
      ${payInput('cardCvv', 'CVV', 'inputmode="numeric" autocomplete="cc-csc" pattern="[0-9]{3,4}" placeholder="123"', 'col-6', '3 or 4 digits.')}</div>
    <div class="small text-body-secondary mt-2">${icon('shield-lock', 'me-1')}Card details go straight to our PCI DSS-certified card partner. MLAZ never stores them.</div>`;
  if (isBank(method)) {
    const row = (k, v) => `<div class="d-flex justify-content-between gap-2"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
    return `<div class="bg-body-tertiary rounded p-3 small d-grid gap-1 mb-3"><div class="fw-semibold mb-1">Pay into this account</div>
        ${row('Bank', BANK.bank)}${row('Account name', BANK.name)}${row('Account number', `<span class="font-monospace">${BANK.number}</span>`)}${row('Branch', BANK.branch)}${row('Payment reference', `<span class="font-monospace">${esc(o.reference)}</span>`)}</div>
      <div class="row g-2">${payInput('bankRef', 'Your bank transaction reference', 'placeholder="e.g. FT26285ABC12"')}
        <div class="col-12"><label class="form-label small fw-medium">Proof of payment <span class="text-body-secondary fw-normal">(PDF, JPG or PNG)</span></label><input class="form-control" type="file" name="pop" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach your deposit slip or transfer confirmation.</div></div></div>
      <div class="small text-body-secondary mt-2">${icon('info-circle', 'me-1')}MLAZ Finance confirms bank transfers, usually within 1 working day. Your receipt is issued once it’s confirmed.</div>`;
  }
  return `${payInput('account', 'Mobile money number', `type="tel" value="${esc(o.phone)}" placeholder="097 000 0000"`)}
    <div class="small text-body-secondary mt-2">${icon('phone', 'me-1')}You’ll get a prompt on this phone to approve with your PIN.</div>`;
}
export const payForm = (id, o = {}) => `<div id="${id}" data-phone="${esc(o.phone || '')}" data-reference="${esc(o.reference || '')}">
  <label class="form-label small fw-medium">Payment method</label><select class="form-select mb-3" name="method" onchange="payMethodChange('${id}')">${PAY_METHODS.map(m => `<option>${m}</option>`).join('')}</select>
  <div data-fields>${payFields(PAY_METHODS[0], { phone: o.phone || '', reference: o.reference || '' })}</div></div>`;
function payMethodChange(id) { const el = document.getElementById(id); el.querySelector('[data-fields]').innerHTML = payFields(el.querySelector('[name=method]').value, el.dataset); }

/* Takes payment for one or more line items from a payForm. Mobile money, QR and card settle straight away;
   a bank transfer is recorded as pending with its proof of payment until Finance confirms it. */
export function takePayment(formId, { payer, description, items, link = {}, onDone }) {
  const el = document.getElementById(formId), v = readForm(el); if (!v) return;
  const amount = items.reduce((n, i) => n + i.amt, 0);
  if (isBank(v.method)) {
    const file = el.querySelector('[name=pop]').files[0], popKey = `pop:${Date.now()}`;
    const refs = items.map(i => addPayment(payer, i.type, i.amt, 'Bank transfer', 'pending', { ...link, bankRef: v.bankRef, pop: file.name, popKey }));
    saveDoc(popKey, file);
    onDone({ refs, pending: true, method: 'Bank transfer', detail: v.bankRef }); commit();
    modal({
      title: 'Proof of payment submitted',
      body: `<div class="text-center py-3"><span class="icon-circle bg-info-subtle text-info-emphasis mb-3" style="width:64px;height:64px;font-size:1.8rem">${icon('hourglass-split')}</span>
        <h5>Awaiting confirmation</h5><p class="text-body-secondary mb-1">${K(amount)} · ${esc(description)} · bank ref ${esc(v.bankRef)}</p>
        <p class="small text-body-secondary mb-0">MLAZ Finance will confirm your transfer, usually within 1 working day. Your receipt will be emailed once it’s confirmed.</p></div>`,
      footer: '<button class="btn btn-primary" data-bs-dismiss="modal">Done</button>',
    });
    return;
  }
  const detail = isCard(v.method) ? `•••• ${v.cardNumber.replace(/\D/g, '').slice(-4)}` : '';
  payFlow({
    amount, description, method: v.method, account: detail || v.account,
    onSuccess: method => {
      const refs = items.map(i => addPayment(payer, i.type, i.amt, method, 'success', { ...link, ...(detail && { detail }) }));
      onDone({ refs, pending: false, method, detail }); commit(); return refs;
    },
  });
}

/* Confirms a pending payment and applies its effect: issues accreditation once an application is fully paid, or marks a member's dues paid. */
export function confirmPayment(p) {
  p.status = 'success';
  if (p.app) {
    const a = appById(p.app);
    if (a?.stage === 'payment_pending' && S.payments.filter(x => x.app === a.id).every(x => x.status === 'success')) {
      a.paymentPending = null; audit(a.id, 'Payment confirmed', `${p.method}${p.bankRef ? ` · ${p.bankRef}` : ''}`); accredit(a);
    }
  }
  if (p.dues) {
    const m = memberById(p.memberId);
    if (m) { m.duesNext = m.duesPaid = true; m.duesPending = null; log(m.id, 'credit-card', 'warning', `${p.dues} dues paid`, `${K(p.amt)} · ${p.method}`); audit(m.id, 'Dues payment confirmed', `${K(p.amt)} · ${p.method}${p.bankRef ? ` · ${p.bankRef}` : ''}`); }
  }
  if (p.event) {
    const r = S.registered.find(x => x.event === p.event && x.member === p.memberId);
    if (r && r.status !== 'confirmed') { r.status = 'confirmed'; log(p.memberId, 'calendar-check', 'primary', `Registered for ${p.event}`, `${tix(r.tickets)} · ${K(p.amt)} · ${p.method}`); audit(p.memberId, 'Event payment confirmed', `${p.event} · ${tix(r.tickets)} · ${K(p.amt)}${p.bankRef ? ` · ${p.bankRef}` : ''}`); }
  }
}
export function payFlow({ amount, description, method, account, onSuccess }) {
  const mobile = /Money|Kwacha/.test(method), qr = isQr(method);
  const el = modal({
    title: 'Complete payment',
    body: qr ? `<div class="text-center py-3">
      <div class="small text-body-secondary">${esc(description)}</div>
      <div class="display-6 fw-semibold my-2">${K(amount)}</div>
      <img class="qr border rounded p-2 my-2" style="width:200px;height:200px" data-qr="${esc(`https://pay.izyane.com/mlaz?amt=${amount}&desc=${encodeURIComponent(description)}`)}" alt="Payment QR code">
      <p class="mb-1 fw-medium">Scan to pay with iZyane Pay</p>
      <p class="small text-body-secondary mb-0"><span class="spinner-border spinner-border-sm me-1"></span> Open your banking or mobile money app and scan the code. Waiting for confirmation…</p>
    </div>` : `<div class="text-center py-3">
      <div class="small text-body-secondary">${esc(description)}</div>
      <div class="display-6 fw-semibold my-2">${K(amount)}</div>
      <div class="spinner-border text-primary my-3" role="status"></div>
      <p class="mb-1 fw-medium">${mobile ? `Payment request sent to ${esc(account)}` : 'Connecting to secure payment gateway…'}</p>
      <p class="small text-body-secondary mb-0">${mobile ? `Approve the ${esc(method)} prompt on your phone and enter your PIN.` : `Paying with ${esc(method)}${account ? ` ${esc(account)}` : ''}. Complete 3-D Secure if your bank asks.`}</p>
    </div>`,
    footer: '<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>',
  });
  if (qr) fillQr(el);
  const timer = setTimeout(() => {
    if (!document.body.contains(el)) return;
    const refs = [].concat(onSuccess(method.replace('MTN Mobile Money', 'MTN MoMo')) || []);
    el.querySelector('.modal-body').innerHTML = `<div class="text-center py-3">
      <span class="icon-circle bg-success-subtle text-success-emphasis mb-3" style="width:64px;height:64px;font-size:1.8rem">${icon('check-lg')}</span>
      <h5>Payment received</h5><p class="text-body-secondary mb-1">${K(amount)} · ${esc(description)}</p><p class="small text-body-secondary mb-0">Receipt ${esc(refs[0] || '')} has been emailed to you.</p></div>`;
    el.querySelector('.modal-footer').innerHTML = `${refs.length ? `<button class="btn btn-light" data-receipt>${icon('receipt', 'me-1')} View receipt</button>` : ''}<button class="btn btn-primary" data-bs-dismiss="modal">Done</button>`;
    el.querySelector('[data-receipt]')?.addEventListener('click', () => { el.close(); setTimeout(() => viewReceipt(refs), 350); });
  }, qr ? 5000 : 2600);
  el.addEventListener('hidden.bs.modal', () => clearTimeout(timer));
}

/* ================= RECEIPTS ================= */
function receiptHtml(ps) {
  const p0 = ps[0], total = ps.reduce((a, p) => a + p.amt, 0);
  return `<div class="receipt border rounded p-4 bg-white">
    <div class="d-flex justify-content-between align-items-start gap-3 mb-4">
      <div><div class="eyebrow">MONEY LENDERS ASSOCIATION OF ZAMBIA</div><h2 class="h4 mt-1 mb-0" style="color:var(--brand-dark)">Official receipt</h2></div>
      <div class="text-end small"><div class="text-body-secondary">Receipt no.</div><div class="fw-semibold font-monospace">${ps.map(p => p.ref).join(', ')}</div></div>
    </div>
    <div class="row g-3 small mb-4">
      <div class="col-sm-6"><div class="text-body-secondary">Received from</div><div class="fw-medium">${esc(p0.member)}</div></div>
      <div class="col-sm-6"><div class="text-body-secondary">Date</div><div class="fw-medium">${p0.at ? fmtDateTime(p0.at) : esc(p0.date)}</div></div>
      <div class="col-sm-6"><div class="text-body-secondary">Payment method</div><div class="fw-medium">${esc(p0.method)}${p0.detail ? ` ${esc(p0.detail)}` : ''}${p0.bankRef ? ` · ref ${esc(p0.bankRef)}` : ''}</div></div>
      <div class="col-sm-6"><div class="text-body-secondary">Status</div><div class="fw-medium text-success-emphasis">${icon('check-circle-fill', 'me-1')}Paid</div></div>
    </div>
    <table class="table table-sm small mb-4"><thead><tr><th>Description</th><th class="text-end">Amount</th></tr></thead><tbody>
      ${ps.map(p => `<tr><td>${esc(p.type)}</td><td class="text-end">${K(p.amt)}</td></tr>`).join('')}
      <tr class="fw-semibold"><td>Total paid</td><td class="text-end">${K(total)}</td></tr></tbody></table>
    <div class="small text-body-secondary">Processed by the iZyane payment gateway. This is a computer-generated receipt and does not require a signature.</div>
  </div>`;
}
export function viewReceipt(refs) {
  // Lines paid together in one bank transfer share a proof of payment and go on one receipt.
  const ps = [].concat(refs).map(r => S.payments.find(p => p.ref === r)).filter(Boolean).flatMap(p => p.popKey ? S.payments.filter(x => x.popKey === p.popKey) : [p]).filter((p, i, all) => all.indexOf(p) === i);
  if (!ps.length) return toast('Receipt not found', 'error');
  const el = modal({
    title: 'Payment receipt', size: 'lg', body: receiptHtml(ps),
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">Close</button><button class="btn btn-primary" data-print>${icon('download', 'me-1')} Download PDF</button>`,
  });
  el.querySelector('[data-print]').onclick = () => printDoc(`MLAZ receipt ${ps[0].ref}`, el.querySelector('.receipt').outerHTML);
}

/* ================= CERTIFICATE ================= */
const verifyUrl = m => `${location.origin}${location.pathname}#/verify/${m.id}`;
function certHtml(m) {
  const yr = new Date(m.expiry).getFullYear();
  return `<div class="certificate">
    <div class="d-flex justify-content-between align-items-start gap-3">
      <div><div class="eyebrow">MONEY LENDERS ASSOCIATION OF ZAMBIA</div><h2 class="h3 mt-1 mb-0" style="color:var(--brand-dark)">Certificate of Accreditation</h2></div>
      <img class="qr" data-qr="${esc(verifyUrl(m))}" alt="Verification QR code">
    </div>
    <p class="text-body-secondary mt-4 mb-1">This certifies that</p>
    <div class="name">${esc(m.name)}</div>
    <p class="mt-2">is an accredited member of the Money Lenders Association of Zambia in good standing, authorized to operate by the Ministry of Finance.</p>
    <div class="d-flex flex-wrap gap-4 mt-3 small">
      <div><div class="text-body-secondary">Member no.</div><b>${m.id}</b></div>
      <div><div class="text-body-secondary">Certificate no.</div><b>${certNo(m)}</b></div>
      <div><div class="text-body-secondary">Tier</div><b>${m.tier}</b></div>
      <div><div class="text-body-secondary">Valid until</div><b>${fmtDate(m.expiry)}</b></div>
    </div>
    <div class="d-flex justify-content-between align-items-end mt-4 gap-3">
      <div class="small text-body-secondary" style="max-width:65%">Scan the QR code or visit the MLAZ verification page and enter the member number to confirm this certificate.</div>
      <div class="seal">MLAZ<br>ACCREDITED<br>${yr - 1}/${String(yr).slice(2)}</div>
    </div>
  </div>`;
}
const fillQr = root => root.querySelectorAll('img[data-qr]').forEach(img => QRCode.toDataURL(img.dataset.qr, { margin: 1, width: 200 }).then(src => { img.src = src; }));
export function viewCert(id) {
  const m = memberById(id);
  const el = modal({
    title: 'Accreditation certificate', size: 'lg', body: certHtml(m),
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">Close</button><button class="btn btn-primary" data-print>${icon('download', 'me-1')} Download PDF</button>`,
  });
  fillQr(el);
  el.querySelector('[data-print]').onclick = () => printDoc('MLAZ Accreditation Certificate', el.querySelector('.certificate').outerHTML);
}
/* Opens the markup in a new window with the app's styles and prints it, so it can be saved as PDF. */
export function printDoc(title, html) {
  const win = window.open('', '_blank');
  if (!win) return toast('Allow pop-ups to download the document', 'error');
  const styles = [...document.querySelectorAll('style')].map(s => s.outerHTML).join('')
    + [...document.querySelectorAll('link[rel=stylesheet]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join('');
  win.document.write(`<!doctype html><html><head><title>${esc(title)}</title>${styles}<style>body{background:#fff;padding:32px}</style></head><body>${html}</body></html>`);
  win.document.close();
  win.onload = () => setTimeout(() => win.print(), 200);
}

export function resetDemo() {
  confirmModal({
    title: 'Reset demo data', body: 'This restores the original sample members, applications and payments. Changes made in this browser will be lost.',
    confirmText: 'Reset', tone: 'danger',
    onConfirm: () => { resetData(); setSession(null); location.hash = '#/'; location.reload(); },
  });
}

expose({ viewCert, viewReceipt, payMethodChange, closeModal, resetDemo, nav });

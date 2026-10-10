import { Modal, Toast } from 'bootstrap';
import QRCode from 'qrcode';
import { load, save, reset, nextId as seqId } from './store.js';

/* ================= STATE ================= */
export const S = load();
export const commit = () => save(S);
export const nextId = (kind, prefix) => seqId(S, kind, prefix);
export const resetData = reset;

// Figures for the ~605 members that exist outside this prototype slice, so headline numbers stay realistic.
const BASE = { members: 605, accredited: 543, duesOutstanding: 72, collected: 2448000, Gold: 210, Silver: 283, Bronze: 110 };
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
export const nextYear = () => new Date().getFullYear() + 1;
const AVA = ['#0b5e3b', '#1e5ba8', '#b7791f', '#7c3aed', '#0e8a89', '#c2410c', '#0b2e59', '#15803d'];
export const avatar = (name, i, lg) => `<span class="avatar ${lg ? 'lg' : ''}" style="background:${AVA[i % AVA.length]}">${esc(initials(name))}</span>`;

/* ================= DOMAIN ================= */
export const memberById = id => S.members.find(m => m.id === id);
export const appById = id => S.apps.find(a => a.id === id);
export const inGoodStanding = m => m.status === 'active' && m.accred === 'issued';
export const certNo = m => `MLAZ/ACC/${m.id.split('-')[1]}/${String(new Date(m.expiry).getFullYear() - 1).slice(2)}`;
export const log = (memberId, icon, tone, title, sub) => { const m = memberById(memberId); if (m) (m.activity ||= []).unshift({ icon, tone, title, sub }); };
export function addPayment(member, type, amt, method, status = 'success') {
  const ref = nextId('pay', 'PAY-');
  S.payments.unshift({ ref, member, type, amt, method, date: nowLabel(), status });
  return ref;
}
export function totals() {
  const totalMembers = BASE.members + S.members.length;
  const accredited = BASE.accredited + S.members.filter(inGoodStanding).length;
  const outstanding = BASE.duesOutstanding + S.members.filter(m => !m.duesPaid).length;
  const collected = BASE.collected + S.payments.filter(p => p.status === 'success').reduce((a, p) => a + p.amt, 0);
  const tiers = { Gold: BASE.Gold, Silver: BASE.Silver, Bronze: BASE.Bronze };
  S.members.forEach(m => tiers[m.tier]++);
  return { totalMembers, accredited, outstanding, collected, tiers };
}
export const counts = () => ({
  open: S.apps.filter(a => a.stage !== 'accredited').length,
  mofReview: S.apps.filter(a => a.stage === 'mof_review').length + S.members.filter(m => m.mofRenewalPending).length,
  ready: S.apps.filter(a => a.stage === 'ready_accredit').length,
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
  details: ['Awaiting documents', 'secondary'], mof_review: ['MoF review', 'warning'], payment_pending: ['Payment pending', 'info'],
  ready_accredit: ['Ready to accredit', 'primary'], accredited: ['Accredited', 'success'],
};
export const stageBadge = s => { const [t, tone] = STAGES[s] || ['Unknown', 'secondary']; return pill(t, tone); };
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
export const PAY_METHODS = ['MTN Mobile Money', 'Airtel Money', 'Zamtel Kwacha', 'Visa / Mastercard', 'Bank transfer'];
export const payMethodSelect = (id = 'paymethod') => `<select class="form-select" id="${id}">${PAY_METHODS.map(m => `<option>${m}</option>`).join('')}</select>`;
export function payFlow({ amount, description, method, account, onSuccess }) {
  const mobile = /Money|Kwacha/.test(method);
  const el = modal({
    title: 'Complete payment',
    body: `<div class="text-center py-3">
      <div class="small text-body-secondary">${esc(description)}</div>
      <div class="display-6 fw-semibold my-2">${K(amount)}</div>
      <div class="spinner-border text-primary my-3" role="status"></div>
      <p class="mb-1 fw-medium">${mobile ? `Payment request sent to ${esc(account)}` : 'Connecting to secure payment gateway…'}</p>
      <p class="small text-body-secondary mb-0">${mobile ? `Approve the ${esc(method)} prompt on your phone and enter your PIN.` : `Paying with ${esc(method)}.`}</p>
    </div>`,
    footer: '<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>',
  });
  const timer = setTimeout(() => {
    if (!document.body.contains(el)) return;
    const ref = onSuccess(method.replace('MTN Mobile Money', 'MTN MoMo'));
    el.querySelector('.modal-body').innerHTML = `<div class="text-center py-3">
      <span class="icon-circle bg-success-subtle text-success-emphasis mb-3" style="width:64px;height:64px;font-size:1.8rem">${icon('check-lg')}</span>
      <h5>Payment received</h5><p class="text-body-secondary mb-1">${K(amount)} · ${esc(description)}</p><p class="small text-body-secondary mb-0">Receipt ${esc(ref || '')} has been emailed to you.</p></div>`;
    el.querySelector('.modal-footer').innerHTML = '<button class="btn btn-primary" data-bs-dismiss="modal">Done</button>';
  }, 2600);
  el.addEventListener('hidden.bs.modal', () => clearTimeout(timer));
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
  el.querySelector('[data-print]').onclick = () => printCert(el.querySelector('.certificate').outerHTML);
}
function printCert(html) {
  const win = window.open('', '_blank');
  if (!win) return toast('Allow pop-ups to download the certificate', 'error');
  const styles = [...document.querySelectorAll('style')].map(s => s.outerHTML).join('')
    + [...document.querySelectorAll('link[rel=stylesheet]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join('');
  win.document.write(`<!doctype html><html><head><title>MLAZ Accreditation Certificate</title>${styles}<style>body{background:#fff;padding:32px}</style></head><body>${html}</body></html>`);
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

expose({ viewCert, closeModal, resetDemo, nav });

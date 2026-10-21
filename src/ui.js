import { Modal, Toast } from 'bootstrap';

// Shared UI helpers: formatting, the session's display details, routing glue and Bootstrap components.
// All data comes from the API (src/api.js); nothing here stores business data in the browser.

/* ================= FORMATTING ================= */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/**
 * A value as a JavaScript string argument inside an HTML event attribute: onclick="fn(${jsArg(x)})".
 * esc() alone is NOT enough there: the browser decodes &#39; back to ' before running the handler. JSON-encoding first
 * keeps quotes and backslashes escaped after that decoding, so the value can never break out of the string.
 */
export const jsArg = s => esc(JSON.stringify(String(s ?? '')).replace(/</g, '\\u003c'));
export const initials = s => String(s ?? '').split(' ').map(w => w[0]).filter(x => /[A-Za-z]/.test(x || '')).slice(0, 2).join('').toUpperCase();
export const K = n => 'K' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const KM = n => n >= 1e6 ? 'K' + (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? 'K' + Math.round(n / 1000) + 'k' : K(n);
export const today = () => new Date().toISOString().slice(0, 10);
export const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const AVA = ['#0b5e3b', '#1e5ba8', '#b7791f', '#7c3aed', '#0e8a89', '#c2410c', '#0b2e59', '#15803d'];
export const avatar = (name, i, lg) => `<span class="avatar ${lg ? 'lg' : ''}" style="background:${AVA[i % AVA.length]}">${esc(initials(name))}</span>`;

/* ================= SESSION & ROUTING ================= */
// Display details of the signed-in user (no tokens: see api.js) live in sessionStorage, or in localStorage when
// "Keep me signed in" is ticked.
const SKEY = 'mlaz-session';
export function getSession() {
  try { return JSON.parse(sessionStorage.getItem(SKEY) || localStorage.getItem(SKEY)); } catch (e) { return null; }
}
export function setSession(s, remember = s?.remember) {
  try {
    sessionStorage.removeItem(SKEY); localStorage.removeItem(SKEY);
    if (s) (remember ? localStorage : sessionStorage).setItem(SKEY, JSON.stringify(s));
  } catch (e) { /* storage blocked: the session only lasts until reload */ }
}
let renderer = () => {};
export const setRenderer = f => { renderer = f; };
export const rerender = () => renderer();
export const nav = path => { const h = '#/' + path; if (location.hash === h) rerender(); else location.hash = h; };
const queue = [];
export const after = fn => queue.push(fn);
export const flushAfter = () => { while (queue.length) queue.shift()(); };
export const clearAfter = () => { queue.length = 0; };

/* Disables a button and shows a spinner while an API call runs. */
export function busy(btn, on, label = 'Please wait…') {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${label}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}
export const expose = o => Object.assign(window, o);

/* ================= UI PRIMITIVES ================= */
export const icon = (n, cls = '') => `<i class="bi bi-${n} ${cls}"></i>`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const pill = (text, tone) => `<span class="badge rounded-pill bg-${tone}-subtle text-${tone}-emphasis border border-${tone}-subtle">${text}</span>`;
export const statusBadge = s => pill(cap(esc(s)), { active: 'success', lapsed: 'warning', suspended: 'danger' }[s] || 'secondary');
export const tierBadge = t => `<span class="badge rounded-pill tier tier-${esc(t)}">${esc(t)}</span>`;
export const accredBadge = a => pill(cap(esc(a)), { issued: 'success', expired: 'warning', revoked: 'danger' }[a] || 'secondary');
export const mofBadge = s => pill(cap(esc(s)), s === 'valid' ? 'success' : 'danger');
const STAGES = {
  details: ['Awaiting documents', 'secondary'], mof_review: ['MoF review', 'warning'], mof_approval: ['Awaiting approval', 'primary'],
  payment_pending: ['Payment pending', 'info'], accredited: ['Accredited', 'success'], rejected: ['Not approved', 'danger'],
};
export const stageBadge = s => { const [t, tone] = STAGES[s] || ['Unknown', 'secondary']; return pill(t, tone); };
export const payBadge = s => pill(cap(esc(s)), { success: 'success', pending: 'warning', failed: 'danger', cancelled: 'secondary' }[s] || 'secondary');

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
  // Move focus out before Bootstrap sets aria-hidden, so assistive tech never sees a hidden element holding focus.
  el.addEventListener('hide.bs.modal', () => { if (el.contains(document.activeElement)) document.activeElement.blur(); });
  el.addEventListener('hidden.bs.modal', () => { m.dispose(); el.remove(); });
  m.show();
  el.close = () => m.hide();
  return el;
}
export function closeAllModals() { document.querySelectorAll('.modal.show').forEach(el => Modal.getInstance(el)?.hide()); }

/**
 * A form in a modal whose submit calls the API. onSubmit(values, form) runs with the button busy; when it resolves the
 * modal closes, when it throws the server's message is shown inside the modal so the user can correct and retry.
 */
export function asyncModal({ title, body, confirmText = 'Confirm', tone = 'primary', size = '', busyText = 'Saving…', onSubmit }) {
  const el = modal({
    title, size,
    body: `<div data-err></div><form novalidate>${body}</form>`,
    footer: `<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button class="btn btn-${tone}" data-ok>${confirmText}</button>`,
  });
  const form = el.querySelector('form'), ok = el.querySelector('[data-ok]'), err = el.querySelector('[data-err]');
  const submit = async () => {
    const v = readForm(form); if (!v) return;
    err.innerHTML = '';
    busy(ok, true, busyText);
    try { await onSubmit(v, form); el.close(); }
    catch (e) {
      busy(ok, false);
      err.innerHTML = `<div class="alert alert-danger small d-flex gap-2">${icon('exclamation-circle')}<div>${esc(e.message)}</div></div>`;
    }
  };
  ok.onclick = submit;
  form.onsubmit = e => { e.preventDefault(); submit(); };
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
    const bad = !el.checkValidity() || (el.required && !(el.type === 'checkbox' ? el.checked : out[el.name]));
    el.classList.toggle('is-invalid', bad); if (bad) ok = false;
  });
  return ok ? out : null;
}

/* NRC inputs: digits only (max 9), with the slashes of 000000/00/0 inserted as the user types. */
export const NRC_ATTRS = 'inputmode="numeric" autocomplete="off" maxlength="11" pattern="[0-9]{6}/[0-9]{2}/[0-9]" placeholder="000000/00/0" oninput="nrcMask(this)"';
const formatNrc = v => { const d = String(v).replace(/\D/g, '').slice(0, 9); return [d.slice(0, 6), d.slice(6, 8), d.slice(8)].filter(Boolean).join('/'); };
function nrcMask(el) {
  // Keep the caret after the same number of digits, so editing mid-number doesn't jump to the end.
  const digitsBefore = el.value.slice(0, el.selectionStart).replace(/\D/g, '').length;
  el.value = formatNrc(el.value);
  let pos = 0, seen = 0;
  while (pos < el.value.length && seen < digitsBefore) { if (/\d/.test(el.value[pos])) seen++; pos++; }
  el.setSelectionRange(pos, pos);
}

/* Fixed-length number inputs (TPIN, PACRA): digits only, capped at n. */
export const digitsAttrs = (n, ph = `${n} digits`) => `inputmode="numeric" autocomplete="off" maxlength="${n}" pattern="[0-9]{${n}}" placeholder="${ph}" oninput="digitsOnly(this)"`;
function digitsOnly(el) { const v = el.value.replace(/\D/g, '').slice(0, el.maxLength); if (v !== el.value) el.value = v; }

/* Opens the markup in a new window with the app's styles and prints it, so it can be saved as PDF. */
export function printDoc(title, html) {
  const win = window.open('', '_blank');
  if (!win) return toast('Allow pop-ups to download the document', 'error');
  const styles = [...document.querySelectorAll('style')].map(s => s.outerHTML).join('')
    + [...document.querySelectorAll('link[rel=stylesheet]')].map(l => `<link rel="stylesheet" href="${esc(l.href)}">`).join('');
  win.document.write(`<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>${styles}<style>body{background:#fff;padding:32px}</style></head><body>${html}</body></html>`);
  win.document.close();
  win.onload = () => setTimeout(() => win.print(), 200);
}

// The prototype kept sample data in this browser; it is no longer used, so clear it out.
try { localStorage.removeItem('mlaz-demo-v3'); indexedDB.deleteDatabase('mlaz-docs'); } catch (e) { /* ignore */ }

expose({ nrcMask, digitsOnly, nav, rerender });

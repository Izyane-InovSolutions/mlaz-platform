import { EL, expose, on } from '../../core/events.js';

/* Disables a button and shows a spinner while an API call runs. */
export function busy(btn, on, label = 'Please wait…') {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${label}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
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
export const NRC_ATTRS = `inputmode="numeric" autocomplete="off" maxlength="11" pattern="[0-9]{6}/[0-9]{2}/[0-9]" placeholder="000000/00/0" ${on('input', 'nrcMask', EL)}`;
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
export const digitsAttrs = (n, ph = `${n} digits`) => `inputmode="numeric" autocomplete="off" maxlength="${n}" pattern="[0-9]{${n}}" placeholder="${ph}" ${on('input', 'digitsOnly', EL)}`;
function digitsOnly(el) { const v = el.value.replace(/\D/g, '').slice(0, el.maxLength); if (v !== el.value) el.value = v; }

expose({ nrcMask, digitsOnly });

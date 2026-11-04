import { Toast } from 'bootstrap';
import { rerender } from '../../core/navigation.js';
import { icon } from './components.js';
import { esc } from './format.js';

export function toast(msg, variant = 'success') {
  const el = document.createElement('div');
  el.className = `toast align-items-center border-0 ${variant === 'error' ? 'text-bg-danger' : 'text-bg-dark'}`;
  // Errors interrupt (alert, assertive); confirmations wait their turn (status, polite).
  el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${icon(variant === 'error' ? 'exclamation-circle' : 'check-circle-fill', 'me-2')}${esc(msg)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  document.getElementById('toasts').appendChild(el);
  el.addEventListener('hidden.bs.toast', () => el.remove());
  new Toast(el, { delay: 3500 }).show();
}

/** After a successful action: confirm it and redraw the page with the new state. */
export const done = msg => { toast(msg); rerender(); };
export const fail = e => toast(e.message, 'error');

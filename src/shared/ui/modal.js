import { Modal } from 'bootstrap';
import { icon } from './components.js';
import { esc } from './format.js';
import { busy, readForm } from './forms.js';

let modalSeq = 0;

export function modal({ title, body, footer = '', size = '' }) {
  const el = document.createElement('div');
  const titleId = `modal-title-${++modalSeq}`;
  el.className = 'modal fade'; el.tabIndex = -1;
  // Named by its title, so screen readers announce what the dialog is for when it opens.
  el.setAttribute('aria-labelledby', titleId);
  el.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size ? 'modal-' + size : ''}"><div class="modal-content">
    <div class="modal-header"><h2 class="modal-title h5" id="${titleId}">${title}</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
    <div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div></div>`;
  document.body.appendChild(el);
  const m = new Modal(el);
  // Focus goes back where it came from when the dialog closes (Bootstrap only does this for data-bs-toggle triggers).
  const opener = document.activeElement;
  // Start at the first field of a form dialog; otherwise Bootstrap focuses the dialog itself.
  el.addEventListener('shown.bs.modal', () => el.querySelector('.modal-body :is(input:not([type=hidden]), select, textarea):not([disabled])')?.focus());
  // Move focus out before Bootstrap sets aria-hidden, so assistive tech never sees a hidden element holding focus.
  el.addEventListener('hide.bs.modal', () => { if (el.contains(document.activeElement)) document.activeElement.blur(); });
  el.addEventListener('hidden.bs.modal', () => {
    m.dispose(); el.remove();
    if (opener instanceof HTMLElement && opener.isConnected && !document.querySelector('.modal.show')) opener.focus();
  });
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
      err.innerHTML = `<div class="alert alert-danger small d-flex gap-2" role="alert">${icon('exclamation-circle')}<div>${esc(e.message)}</div></div>`;
    }
  };
  ok.onclick = submit;
  form.onsubmit = e => { e.preventDefault(); submit(); };
  return el;
}

import { EL, expose, on } from '../../../core/events.js';
import { rerender } from '../../../core/navigation.js';
import { K, busy, done, esc, fail, note, readForm } from '../../../shared/ui/index.js';
import { getFile, runCheckout } from '../../common/index.js';
import { portal } from './api.js';

/** Bank details and proof-of-payment upload for a pending bank transfer. */
export function bankTransferBlock(p) {
  if (!p.awaitingProof) return note('info', 'hourglass-split', `We’ve received your proof of payment for <b>${K(p.amount)}</b> (bank ref ${esc(p.bankRef)}). MLAZ Finance will confirm the transfer, usually within 1 working day; your receipt follows.`, 'mb-0');
  const b = p.bankAccount || {};
  const line = (k, v) => `<div class="d-flex justify-content-between gap-2"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
  return `<div class="bg-body-tertiary rounded p-3 small d-grid gap-1 mb-3"><div class="fw-semibold mb-1">Pay ${K(p.amount)} into this account</div>
      ${line('Bank', esc(b.bank))}${line('Account name', esc(b.name))}${line('Account number', `<span class="font-monospace">${esc(b.number)}</span>`)}${line('Branch', esc(b.branch))}${line('Payment reference', `<span class="font-monospace">${esc(p.ref)}</span>`)}</div>
    <form class="d-grid gap-2" novalidate ${on('submit', 'submitProof', p.ref, EL)}>
      <div><label class="form-label small fw-medium">Your bank transaction reference</label><input class="form-control" name="bankRef" required maxlength="60" placeholder="e.g. FT26285ABC12"><div class="invalid-feedback">Required.</div></div>
      <div><label class="form-label small fw-medium">Proof of payment <span class="text-body-secondary fw-normal">(PDF, JPG or PNG)</span></label><input class="form-control" type="file" name="proof" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach your deposit slip or transfer confirmation.</div></div>
      <button class="btn btn-primary">Submit proof of payment</button></form>`;
}
async function submitProof(ref, form) {
  if (!readForm(form)) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Uploading…');
  try { await portal(`/payments/${encodeURIComponent(ref)}/proof`, { method: 'POST', form: new FormData(form) }); done('Proof of payment submitted'); }
  catch (e) { busy(btn, false); fail(e); }
}
export async function startCheckout(start, btn) {
  busy(btn, true, 'Starting payment…');
  try {
    await runCheckout({
      start, poll: ref => portal(`/payments/${encodeURIComponent(ref)}`),
      receipt: ref => getFile(`/portal/payments/${encodeURIComponent(ref)}/receipt.pdf`),
      onDone: () => rerender(),
    });
  } catch (e) { fail(e); if (e.status === 409) rerender(); } finally { busy(btn, false); }
}
// A gateway payment still in progress: look again shortly, only while the same page stays open.
export function pollLater() {
  const hash = location.hash;
  setTimeout(() => { if (location.hash === hash) rerender(); }, 5000);
  return '';
}

expose({ submitProof });

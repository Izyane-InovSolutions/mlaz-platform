// Online checkout against the API: choose a method, start the payment, then follow it until the gateway confirms.
// Card payments open the gateway's secure page, so card numbers are never typed into MLAZ.
import QRCode from 'qrcode';
import { K, esc, expose, icon, modal, on } from './ui.js';

const MOBILE = ['MTN_MOMO', 'AIRTEL_MONEY', 'ZAMTEL_KWACHA'];

function fields(method, phone) {
  if (MOBILE.includes(method)) return `<label class="form-label small fw-medium">Mobile money number</label>
    <input class="form-control" name="msisdn" type="tel" value="${esc(phone)}" placeholder="097 000 0000" required pattern="[0-9 +\\(\\)\\-]{9,20}">
    <div class="invalid-feedback">Enter the number to charge.</div>
    <div class="small text-body-secondary mt-2">${icon('phone', 'me-1')}You’ll get a prompt on this phone to approve with your PIN.</div>`;
  if (method === 'IZYANE_QR') return `<div class="alert alert-light border small d-flex gap-2 mb-0">${icon('qr-code')}<div>You’ll be shown a QR code to scan with your banking or mobile money app.</div></div>`;
  if (method === 'CARD') return `<div class="alert alert-light border small d-flex gap-2 mb-0">${icon('shield-lock')}<div>You’ll pay on our card partner’s secure page. MLAZ never sees your card details.</div></div>`;
  return `<div class="alert alert-light border small d-flex gap-2 mb-0">${icon('bank')}<div>You’ll get the MLAZ bank details and a payment reference, then upload your proof of payment.</div></div>`;
}

/** The method picker. `methods` is publicConfig().paymentMethods: [{ code, label }]. */
export const checkoutForm = (id, { methods, phone = '' }) => `<div id="${id}" data-phone="${esc(phone)}">
  <label class="form-label small fw-medium">Payment method</label>
  <select class="form-select mb-3" name="method" ${on('change', 'checkoutMethodChange', id)}>${methods.map(m => `<option value="${esc(m.code)}">${esc(m.label)}</option>`).join('')}</select>
  <div data-fields>${fields(methods[0]?.code, phone)}</div></div>`;

function checkoutMethodChange(id) {
  const el = document.getElementById(id);
  el.querySelector('[data-fields]').innerHTML = fields(el.querySelector('[name=method]').value, el.dataset.phone);
}

/** Reads and validates the picker. Returns { method, msisdn? } or null. */
export function readCheckout(id) {
  const el = document.getElementById(id), method = el.querySelector('[name=method]').value, input = el.querySelector('[name=msisdn]');
  if (input) {
    const bad = !input.checkValidity() || !input.value.trim();
    input.classList.toggle('is-invalid', bad);
    if (bad) return null;
    return { method, msisdn: input.value.trim() };
  }
  return { method };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const POLL_MS = 2500, GIVE_UP_MS = 5 * 60_000;

function pendingBody(p) {
  const mobile = MOBILE.includes(p.method);
  const head = `<div class="small text-body-secondary">${esc(p.lines.map(l => l.description).join(' · '))}</div><div class="display-6 fw-semibold my-2">${K(p.amount)}</div>`;
  if (p.method === 'IZYANE_QR') return `<div class="text-center py-3">${head}
    <img class="qr border rounded p-2 my-2" style="width:200px;height:200px" data-qr="${esc(p.qrPayload || '')}" alt="Payment QR code">
    <p class="mb-1 fw-medium">Scan to pay with iZyane Pay</p>
    <p class="small text-body-secondary mb-0"><span class="spinner-border spinner-border-sm me-1"></span>Waiting for confirmation…</p></div>`;
  return `<div class="text-center py-3">${head}<div class="spinner-border text-primary my-3" role="status"></div>
    <p class="mb-1 fw-medium">${mobile ? `Payment request sent to ${esc(p.msisdn)}` : 'Complete your payment on the secure page'}</p>
    <p class="small text-body-secondary mb-2">${mobile ? `Approve the ${esc(p.methodLabel)} prompt on your phone and enter your PIN.` : 'Complete 3-D Secure if your bank asks. This window updates when the payment is confirmed.'}</p>
    ${p.checkoutUrl ? `<a class="btn btn-outline-primary btn-sm" href="${esc(p.checkoutUrl)}" target="_blank" rel="noopener">${icon('box-arrow-up-right', 'me-1')}Open secure checkout</a>` : ''}
    <div class="small text-body-secondary mt-2">Reference ${esc(p.ref)}</div></div>`;
}

const resultBody = p => p.status === 'SUCCESS'
  ? `<div class="text-center py-3"><span class="icon-circle bg-success-subtle text-success-emphasis mb-3" style="width:64px;height:64px;font-size:1.8rem">${icon('check-lg')}</span>
      <h5>Payment received</h5><p class="text-body-secondary mb-1">${K(p.amount)} · ${esc(p.methodLabel)}</p><p class="small text-body-secondary mb-0">Receipt ${esc(p.ref)} has been emailed to you.</p></div>`
  : p.status === 'PENDING'
    ? `<div class="text-center py-3"><span class="icon-circle bg-info-subtle text-info-emphasis mb-3" style="width:64px;height:64px;font-size:1.8rem">${icon('hourglass-split')}</span>
        <h5>Still waiting for confirmation</h5><p class="small text-body-secondary mb-0">Payment ${esc(p.ref)} hasn’t been confirmed yet. We’ll update your record as soon as the provider confirms it; you don’t need to pay again.</p></div>`
    : `<div class="text-center py-3"><span class="icon-circle bg-danger-subtle text-danger-emphasis mb-3" style="width:64px;height:64px;font-size:1.8rem">${icon('x-lg')}</span>
        <h5>Payment not completed</h5><p class="text-body-secondary mb-0">${esc(p.failureReason || 'The payment did not go through.')} You have not been charged. Please try again.</p></div>`;

/**
 * Runs an online payment: start() creates it on the server, poll(ref) re-reads it. Bank transfers return straight away
 * (the page then shows the bank details and proof upload). onDone(payment) runs once when the dialog is closed.
 * receipt(ref) downloads the receipt, offered after a successful payment.
 */
export async function runCheckout({ start, poll, onDone, receipt }) {
  let p = await start();
  if (p.method === 'BANK_TRANSFER' || p.status !== 'PENDING') { onDone(p); return; }

  const el = modal({ title: 'Complete payment', body: pendingBody(p), footer: '<button class="btn btn-light" data-bs-dismiss="modal">Close</button>' });
  el.querySelectorAll('img[data-qr]').forEach(img => img.dataset.qr && QRCode.toDataURL(img.dataset.qr, { margin: 1, width: 200 }).then(src => { img.src = src; }));
  let open = true;
  el.addEventListener('hidden.bs.modal', () => { open = false; onDone(p); });

  const started = Date.now();
  while (open && p.status === 'PENDING' && Date.now() - started < GIVE_UP_MS) {
    await sleep(POLL_MS);
    if (!open) return;
    try { p = await poll(p.ref); } catch (e) { /* keep waiting through a network blip */ }
  }
  if (!open) return;
  el.querySelector('.modal-body').innerHTML = resultBody(p);
  el.querySelector('.modal-footer').innerHTML = `${p.status === 'SUCCESS' && receipt ? `<button class="btn btn-light" data-receipt>${icon('receipt', 'me-1')} Download receipt</button>` : ''}<button class="btn btn-primary" data-bs-dismiss="modal">Done</button>`;
  el.querySelector('[data-receipt]')?.addEventListener('click', () => receipt(p.ref));
}

expose({ checkoutMethodChange });

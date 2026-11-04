import { download, pub } from '../../../core/api/client.js';
import { forgetTrackToken, isTrackingToken, publicConfig, saveTrackToken, trackToken } from '../../../core/reference-data.js';
import { EL, expose, on } from '../../../core/events.js';
import { after, nav, rerender } from '../../../core/navigation.js';
import { K, busy, esc, fmtDate, icon, lower, note as alertBox, readForm, safeUrl, stepper, toast } from '../../../shared/ui/index.js';
import { checkoutForm, readCheckout, runCheckout, stageBadge } from '../../common/index.js';

// Anything read from the URL is checked against its exact format before it is used anywhere.
const isAppRef = r => /^APP-\d{4,8}$/.test(r);

/* ================= TRACK APPLICATION ================= */
// Applicants have no account: their application opens with the token from the emailed link (?t=…), which this
// browser also remembers from the moment they applied.
const TRACK_STEPS = ['Submitted', 'MoF authorization', 'Verification', 'Payment', 'Accredited'];
const TRACK_IDX = { DETAILS: 1, MOF_REVIEW: 2, PAYMENT_PENDING: 3, ACCREDITED: 5 };
const tokenHeader = ref => ({ 'x-tracking-token': trackToken(ref) || '' });
let trackTimer = null;

export async function track(refParam, query) {
  clearTimeout(trackTimer);
  const ref = (refParam || '').trim().toUpperCase();
  const linkToken = query?.get('t');
  if (ref && isAppRef(ref) && isTrackingToken(linkToken)) saveTrackToken(ref, linkToken);
  // Keep the token out of the address bar (and screenshots, shared links, history) once it's remembered.
  if (linkToken) history.replaceState(null, '', ref ? `#/track/${encodeURIComponent(ref)}` : '#/track');
  let result = '';
  if (ref && !isAppRef(ref)) result = alertBox('warning', 'exclamation-triangle', 'That doesn’t look like an application reference. References look like <b>APP-2042</b>.');
  else if (ref && !trackToken(ref)) result = needLink(ref, false);
  else if (ref) {
    try {
      const [a, cfg] = await Promise.all([pub(`/applications/${encodeURIComponent(ref)}`, { headers: tokenHeader(ref) }), publicConfig()]);
      result = trackCard(a, cfg);
    } catch (e) {
      if (e.status !== 404) throw e;
      forgetTrackToken(ref);
      result = needLink(ref, true);
    }
  }
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container mw-860">
    <h1 class="h2 fw-bold mb-1">Track your application</h1><p class="text-body-secondary">Open the link in your confirmation email, or enter your reference, e.g. APP-2042.</p>
    <form class="d-flex gap-2 mb-4" ${on('submit', 'trackSearch', EL)}>
      <input class="form-control form-control-lg" name="ref" aria-label="Application reference" placeholder="Application reference" value="${esc(ref)}" required>
      <button class="btn btn-primary btn-lg px-4">Track</button>
    </form>${result}</div></section>`;
}

const needLink = (ref, invalid) => `<div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5">
  <div class="d-flex gap-3 mb-3"><span class="icon-circle md bg-warning-subtle text-warning-emphasis">${icon(invalid ? 'exclamation-triangle' : 'envelope-paper')}</span>
  <div><h2 class="h5 mb-1">${invalid ? `We couldn’t open application ${esc(ref)}` : `Open your tracking link for ${esc(ref)}`}</h2>
  <p class="small text-body-secondary mb-0">${invalid ? 'The reference or link isn’t valid. Check the reference in your confirmation email.' : 'To keep applications private, they can only be opened from the link we emailed when you applied, or in the browser you applied from.'}
  Enter the email address on the application and we’ll send the link again.</p></div></div>
  <form class="row g-2" novalidate ${on('submit', 'trackResend', ref, EL)}>
    <div class="col-sm"><input class="form-control" type="email" name="email" aria-label="Contact email on the application" placeholder="Contact email on the application" required><div class="invalid-feedback">Enter a valid email address.</div></div>
    <div class="col-sm-auto"><button class="btn btn-primary w-100">Email me the link</button></div>
  </form></div></div>`;

function trackCard(a, cfg) {
  if (!isAppRef(a.ref)) throw new Error('Unexpected application reference');
  const ref = esc(a.ref); // validated format: digits and "APP-" only
  const fees = `<div class="bg-body-tertiary rounded p-3 small">
    <div class="d-flex justify-content-between"><span>Joining fee</span><span>${K(a.fees.joiningFee)}</span></div>
    <div class="d-flex justify-content-between"><span>${esc(a.tier)} annual dues</span><span>${K(a.fees.annualDues)}</span></div>
    <div class="d-flex justify-content-between fw-semibold border-top mt-2 pt-2"><span>Total due</span><span>${K(a.fees.total)}</span></div></div>`;
  const payBlock = `<div class="row g-4"><div class="col-md-6">${fees}</div>
    <div class="col-md-6">${checkoutForm('tpay', { methods: cfg.paymentMethods })}
      <button class="btn btn-primary w-100 mt-3" ${on('click', 'trackPay', a.ref, EL)}>Pay ${K(a.fees.total)}</button>
      <div class="small text-body-secondary text-center mt-2">${icon('lock', 'me-1')}Secured payment · receipt emailed automatically</div></div></div>`;

  let action = '';
  if (a.stage === 'DETAILS') action = `${a.returnNote ? alertBox('danger', 'arrow-return-left', `<b>Returned by the Secretariat:</b> ${esc(a.returnNote)}`) : ''}
    <h3 class="h6 fw-semibold">Upload your Ministry of Finance authorization</h3>
    <form id="mofform" class="row g-3" novalidate ${on('submit', 'trackUpload', a.ref, EL)}>
      <div class="col-12"><label class="form-label small fw-medium">Authorization reference</label><input class="form-control" name="mofRef" required placeholder="MoF/ML/2026/0000"><div class="invalid-feedback">Required.</div></div>
      <div class="col-12"><label class="form-label small fw-medium">Document <span class="text-body-secondary fw-normal">(PDF, JPG or PNG, up to 10 MB)</span></label><input class="form-control" type="file" name="mofFile" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach the authorization document.</div></div>
      <div class="col-12"><button class="btn btn-primary">Submit for verification</button></div>
    </form>`;

  if (a.stage === 'MOF_REVIEW') action = alertBox('info', 'hourglass-split', `Your authorization <b>${esc(a.mofRef)}</b> is being verified by the Secretariat. This usually takes 1–2 working days. We’ll email you when it’s done.`, 'mb-0 fs-6');

  if (a.stage === 'PAYMENT_PENDING') {
    const p = a.payment?.status === 'PENDING' ? a.payment : null;
    if (p?.method === 'BANK_TRANSFER' && p.awaitingProof) {
      const b = p.bankAccount || {};
      const row = (k, v) => `<div class="d-flex justify-content-between gap-2"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
      action = `${alertBox('success', 'check-circle', 'Your MoF authorization has been verified. Complete your bank transfer, then upload the proof of payment.')}
        <div class="row g-4"><div class="col-md-6"><div class="bg-body-tertiary rounded p-3 small d-grid gap-1"><div class="fw-semibold mb-1">Pay ${K(p.amount)} into this account</div>
          ${row('Bank', esc(b.bank))}${row('Account name', esc(b.name))}${row('Account number', `<span class="font-monospace">${esc(b.number)}</span>`)}${row('Branch', esc(b.branch))}${row('Payment reference', `<span class="font-monospace">${esc(p.ref)}</span>`)}</div></div>
        <div class="col-md-6"><form id="proofform" class="d-grid gap-2" novalidate ${on('submit', 'trackProof', a.ref, p.ref, EL)}>
          <div><label class="form-label small fw-medium">Your bank transaction reference</label><input class="form-control" name="bankRef" required placeholder="e.g. FT26285ABC12"><div class="invalid-feedback">Required.</div></div>
          <div><label class="form-label small fw-medium">Proof of payment <span class="text-body-secondary fw-normal">(PDF, JPG or PNG)</span></label><input class="form-control" type="file" name="proof" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach your deposit slip or transfer confirmation.</div></div>
          <button class="btn btn-primary">Submit proof of payment</button></form></div></div>
        <details class="mt-4"><summary class="small">Pay another way instead</summary><div class="mt-3">${payBlock}</div></details>`;
    } else if (p?.method === 'BANK_TRANSFER') {
      action = alertBox('info', 'hourglass-split', `We’ve received your proof of payment for <b>${K(p.amount)}</b> (bank ref ${esc(p.bankRef)}). MLAZ Finance will confirm the transfer, usually within 1 working day, and your accreditation certificate is issued automatically once it’s confirmed.`, 'mb-0 fs-6');
    } else if (p) {
      action = alertBox('info', 'hourglass-split', `<div class="d-flex align-items-center gap-2"><span class="spinner-border spinner-border-sm"></span><b>Waiting for confirmation of payment ${esc(p.ref)}</b> (${K(p.amount)} by ${esc(p.methodLabel)})</div>
        <div class="mt-1">This page updates automatically.${safeUrl(p.checkoutUrl, 'https') ? ` <a href="${esc(safeUrl(p.checkoutUrl, 'https'))}" target="_blank" rel="noopener noreferrer">Open secure checkout</a>.` : ''}</div>`, 'mb-0 fs-6');
      after(() => { trackTimer = setTimeout(() => { if (location.hash === `#/track/${encodeURIComponent(a.ref)}`) rerender(); }, 4000); });
    } else {
      action = `${alertBox('success', 'check-circle', 'Your MoF authorization has been verified. Complete payment to receive your accreditation.')}${payBlock}`;
    }
  }

  if (a.stage === 'ACCREDITED') action = `${alertBox('success', 'award', `Congratulations, you are now an accredited MLAZ member. Your member number is <b>${esc(a.member?.number)}</b>.`)}
    <p class="small">We’ve emailed <b>${esc(a.contactEmail)}</b> a link to set your member portal password. Use it within 7 days.</p>
    <div class="d-flex flex-wrap gap-2">
      <button class="btn btn-outline-primary" ${on('click', 'trackCert', a.ref, EL)}>${icon('award', 'me-1')} Download certificate</button>
      ${a.payment?.status === 'SUCCESS' ? `<button class="btn btn-outline-secondary" ${on('click', 'trackReceipt', a.ref, a.payment.ref, EL)}>${icon('receipt', 'me-1')} Receipt</button>` : ''}
      <a class="btn btn-primary" href="#/login/member">Go to member portal</a></div>`;

  if (a.stage === 'REJECTED') action = alertBox('danger', 'x-octagon', `<b>This application was not approved.</b> ${esc(a.rejectionReason || '')}<div class="mt-1">Contact the Secretariat on secretariat@mlaz.org.zm if you have questions.</div>`, 'mb-0 fs-6');

  return `<div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-4"><div><div class="small text-body-secondary font-monospace">${ref}</div><h2 class="h4 mb-0">${esc(a.businessName)}</h2><div class="small text-body-secondary">${esc(a.town)} · ${esc(a.tier)} tier · submitted ${fmtDate(a.submittedAt)}</div></div>${stageBadge(lower(a.stage))}</div>
    ${TRACK_IDX[a.stage] ? `<div class="mb-4">${stepper(TRACK_STEPS, TRACK_IDX[a.stage])}</div>` : ''}${action}</div></div>`;
}

async function trackUpload(ref, form) {
  if (!readForm(form)) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Uploading…');
  try {
    await pub(`/applications/${ref}/mof`, { method: 'POST', form: new FormData(form), headers: tokenHeader(ref) });
    toast('Authorization submitted for verification');
    rerender();
  } catch (e) { busy(btn, false); toast(e.message, 'error'); }
}

async function trackPay(ref, btn) {
  const checkout = readCheckout('tpay'); if (!checkout) return;
  busy(btn, true, 'Starting payment…');
  try {
    await runCheckout({
      start: () => pub(`/applications/${ref}/payments`, { method: 'POST', body: checkout, headers: tokenHeader(ref) }),
      poll: payRef => pub(`/applications/${ref}/payments/${encodeURIComponent(payRef)}`, { headers: tokenHeader(ref) }),
      receipt: payRef => trackReceipt(ref, payRef),
      onDone: () => rerender(),
    });
  } catch (e) {
    toast(e.message, 'error');
    if (e.status === 409) rerender(); // a payment is already in flight: show its status
  } finally { busy(btn, false); }
}

async function trackProof(ref, payRef, form) {
  if (!readForm(form)) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Uploading…');
  try {
    await pub(`/applications/${ref}/payments/${encodeURIComponent(payRef)}/proof`, { method: 'POST', form: new FormData(form), headers: tokenHeader(ref) });
    toast('Proof of payment submitted');
    rerender();
  } catch (e) { busy(btn, false); toast(e.message, 'error'); }
}

async function trackFile(path, ref, btn) {
  busy(btn, true, 'Preparing…');
  try { await download(path, { auth: false, headers: tokenHeader(ref) }); } catch (e) { toast(e.message, 'error'); } finally { busy(btn, false); }
}
const trackCert = (ref, btn) => trackFile(`/public/applications/${ref}/certificate.pdf`, ref, btn);
const trackReceipt = (ref, payRef, btn) => trackFile(`/public/applications/${ref}/payments/${encodeURIComponent(payRef)}/receipt.pdf`, ref, btn);

async function trackResend(ref, form) {
  const v = readForm(form); if (!v) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Sending…');
  try {
    await pub(`/applications/${ref}/resend-link`, { method: 'POST', body: { email: v.email } });
    form.outerHTML = alertBox('success', 'envelope-check', `If <b>${esc(v.email)}</b> is the contact email on ${esc(ref)}, the tracking link is on its way. Check your inbox (and spam folder).`, 'mb-0');
  } catch (e) { busy(btn, false); toast(e.message, 'error'); }
}

const trackSearch = form => nav(`track/${encodeURIComponent(form.ref.value.trim().toUpperCase())}`);

expose({ trackUpload, trackPay, trackProof, trackCert, trackReceipt, trackResend, trackSearch });

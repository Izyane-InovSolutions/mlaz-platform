import { ApiError, pub } from '../../../core/api/client.js';
import { publicConfig, saveTrackToken } from '../../../core/reference-data.js';
import { EL, expose, on } from '../../../core/events.js';
import { after } from '../../../core/navigation.js';
import { K, NRC_ATTRS, busy, digitsAttrs, esc, icon, note as alertBox, readForm, stepper } from '../../../shared/ui/index.js';
import { tiersByPrice } from '../shared/tiers.js';

/* ================= APPLY ================= */
const W_STEPS = ['Business', 'Contact', 'Documents', 'Review'];
let W = null;
const tierDues = name => W.cfg.tiers.find(t => t.name === name)?.annualDues ?? 0;

export async function apply(tier) {
  const cfg = await publicConfig();
  const names = cfg.tiers.map(t => t.name);
  W = { step: 0, cfg, data: { tier: names.includes(tier) ? tier : names.includes('Silver') ? 'Silver' : names[0] }, blobs: {} };
  after(renderWizard);
  return `<section class="py-5 bg-body-tertiary min-vh-75">
    <div class="container">
      <div class="mb-4"><a href="#/" class="small text-body-secondary">${icon('arrow-left', 'me-1')}Back to home</a><h1 class="h2 fw-bold mt-2 mb-1">Apply for membership</h1><p class="text-body-secondary mb-0">Join the Money Lenders Association of Zambia.</p></div>
      <div class="row g-4">
        <div class="col-lg-8"><div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5" id="wizard"></div></div></div>
        <div class="col-lg-4">
          <div class="card border-0 shadow-sm mb-4"><div class="card-body p-4">
            <h2 class="h6 fw-semibold mb-3">What you’ll need</h2>
            <ul class="list-unstyled small d-grid gap-2 mb-0">
              <li>${icon('file-earmark-text', 'text-primary me-2')}PACRA certificate of incorporation and ZRA TPIN</li>
              <li>${icon('person-vcard', 'text-primary me-2')}A director’s NRC (PDF or image)</li>
              <li>${icon('file-earmark-check', 'text-primary me-2')}Ministry of Finance money-lending authorization (PDF or image)</li>
              <li>${icon('person', 'text-primary me-2')}A contact person, phone number and email</li>
              <li>${icon('phone', 'text-primary me-2')}Mobile money, card or bank account to pay fees</li>
            </ul>
          </div></div>
          <div class="card border-0 shadow-sm"><div class="card-body p-4">
            <h2 class="h6 fw-semibold mb-3">Need help?</h2>
            <p class="small text-body-secondary mb-2">Contact the MLAZ Secretariat on <a href="mailto:secretariat@mlaz.org.zm">secretariat@mlaz.org.zm</a>.</p>
            <p class="small text-body-secondary mb-0">Already applied? <a href="#/track">Track your application</a>.</p>
          </div></div>
        </div>
      </div>
    </div>
  </section>`;
}
function renderWizard() {
  const box = document.getElementById('wizard'); if (!box) return;
  const d = W.data;
  const f = (name, label, opts = {}) => `<div class="${opts.col || 'col-md-6'}"><label class="form-label small fw-medium">${label}${opts.req === false ? ' <span class="text-body-secondary fw-normal">(optional)</span>' : ''}</label>
    <input class="form-control" name="${name}" type="${opts.type || 'text'}" ${opts.req === false ? '' : 'required'} ${opts.attrs || `${opts.pattern ? `pattern="${opts.pattern}"` : ''} placeholder="${opts.ph || ''}"`} value="${esc(d[name] || '')}">
    <div class="invalid-feedback">${opts.err || 'This field is required.'}</div></div>`;
  // A file already attached on an earlier visit to this step stays attached, so the input is only required when nothing is on file.
  const file = (name, label, req = true) => `<div class="col-12"><label class="form-label small fw-medium">${label} <span class="text-body-secondary fw-normal">(PDF, JPG or PNG, up to 10 MB${req ? '' : ', optional'})</span></label>
    <input class="form-control" type="file" name="${name}" accept=".pdf,.jpg,.jpeg,.png" ${req && !d[name] ? 'required' : ''}>${d[name] ? `<div class="form-text">${icon('paperclip')} ${esc(d[name])} attached</div>` : ''}<div class="invalid-feedback">Attach this document.</div></div>`;
  let body = '';
  if (W.step === 0) body = `<h2 class="h5 mb-1">Business details</h2><p class="small text-body-secondary mb-4">As registered with PACRA.</p>
    <div class="row g-3">
      ${f('name', 'Registered business name', { col: 'col-12' })}
      ${f('pacra', 'PACRA registration number', { attrs: digitsAttrs(12, 'e.g. 120240012345'), err: 'Enter your 12-digit PACRA number.' })}
      ${f('tpin', 'ZRA TPIN', { attrs: digitsAttrs(10, 'e.g. 1001845523'), err: 'Enter your 10-digit TPIN.' })}
      ${f('town', 'Town / city')}
      <div class="col-md-6"><label class="form-label small fw-medium">Province</label><select class="form-select" name="province" required><option value="">Select province</option>${W.cfg.provinces.map(p => `<option ${d.province === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select><div class="invalid-feedback">Select a province.</div></div>
      ${f('address', 'Physical address', { col: 'col-12' })}
      <div class="col-12"><label class="form-label small fw-medium">Membership tier</label><div class="row g-2">
        ${tiersByPrice(W.cfg).map(t => `<div class="col-md-4"><label class="tier-option border rounded p-3 d-flex gap-2 h-100"><input class="form-check-input" type="radio" name="tier" value="${esc(t.name)}" ${d.tier === t.name ? 'checked' : ''}><span><span class="fw-semibold d-block">${esc(t.name)}</span><span class="small text-body-secondary">${K(t.annualDues)} / year</span></span></label></div>`).join('')}
      </div></div>
    </div>`;
  if (W.step === 1) body = `<h2 class="h5 mb-1">Contact person</h2><p class="small text-body-secondary mb-4">We’ll send application updates and your tracking link to this person.</p>
    <div class="row g-3">${f('contact', 'Full name')}${f('position', 'Position', { ph: 'e.g. Managing Director' })}${f('phone', 'Phone number', { type: 'tel', ph: '097 000 0000' })}${f('email', 'Email address', { type: 'email', err: 'Enter a valid email address.' })}</div>`;
  if (W.step === 2) body = `<h2 class="h5 mb-1">Documents</h2><p class="small text-body-secondary mb-4">Company and director documents, and your Ministry of Finance authorization.</p>
    <h3 class="h6 fw-semibold">Company and director</h3>
    <div class="row g-3 mb-4">${file('pacraFile', 'PACRA certificate of incorporation')}
      ${f('director', 'Director full name')}${f('directorNrc', 'Director NRC number', { attrs: NRC_ATTRS, err: 'Enter all 9 digits, e.g. 284512/11/1.' })}
      ${file('nrcFile', 'Copy of director’s NRC')}</div>
    <h3 class="h6 fw-semibold">Ministry of Finance authorization</h3>
    ${alertBox('info', 'info-circle', 'Don’t have it to hand? Leave both fields blank and upload it later from <b>Track application</b>, using the link we email you.')}
    <div class="row g-3">${f('mofRef', 'Authorization reference', { req: false, ph: 'MoF/ML/2026/0000', col: 'col-12' })}${file('mofFile', 'Authorization document', false)}</div>`;
  if (W.step === 3) {
    const row = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
    body = `<h2 class="h5 mb-1">Review and submit</h2><p class="small text-body-secondary mb-4">Please confirm your details are correct.</p>
      <div class="row g-4">
        <div class="col-md-6"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Business</div>${row('Name', esc(d.name))}${row('PACRA no.', esc(d.pacra))}${row('TPIN', esc(d.tpin))}${row('Location', `${esc(d.town)}, ${esc(d.province)}`)}${row('Tier', esc(d.tier))}</div>
        <div class="col-md-6"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Contact</div>${row('Name', esc(d.contact))}${row('Phone', esc(d.phone))}${row('Email', esc(d.email))}${row('Director', `${esc(d.director)} · ${esc(d.directorNrc)}`)}</div>
        <div class="col-12"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Documents</div>${row('PACRA certificate', esc(d.pacraFile))}${row('Director NRC', esc(d.nrcFile))}${row('MoF authorization', d.mofRef ? esc(`${d.mofRef} · ${d.mofFile}`) : '<span class="text-warning-emphasis">To upload later</span>')}</div>
      </div>
      <div class="bg-body-tertiary rounded p-3 mt-4 small">
        <div class="d-flex justify-content-between"><span>Joining fee (one-off)</span><span>${K(W.cfg.joiningFee)}</span></div>
        <div class="d-flex justify-content-between"><span>${esc(d.tier)} annual dues</span><span>${K(tierDues(d.tier))}</span></div>
        <div class="d-flex justify-content-between fw-semibold border-top mt-2 pt-2"><span>Payable after MoF verification</span><span>${K(W.cfg.joiningFee + tierDues(d.tier))}</span></div>
      </div>
      <div class="form-check mt-4"><input class="form-check-input" type="checkbox" name="declare" id="declare" required><label class="form-check-label small" for="declare">I confirm the information provided is accurate and agree to abide by the MLAZ constitution and code of conduct.</label><div class="invalid-feedback">You must accept the declaration to submit.</div></div>`;
  }
  box.innerHTML = `<div class="mb-4">${stepper(W_STEPS, W.step)}</div><div id="wizerr"></div><form id="wform" novalidate>${body}</form>
    <div class="d-flex justify-content-between mt-4 pt-3 border-top">
      <button class="btn btn-light" ${W.step === 0 ? 'disabled' : ''} ${on('click', 'wizPrev')}>${icon('arrow-left', 'me-1')} Back</button>
      ${W.step < 3 ? `<button class="btn btn-primary" ${on('click', 'wizNext')}>Continue ${icon('arrow-right', 'ms-1')}</button>` : `<button class="btn btn-primary" ${on('click', 'wizSubmit', EL)}>Submit application</button>`}
    </div>`;
}
const wizError = html => { document.getElementById('wizerr').innerHTML = html ? alertBox('danger', 'exclamation-circle', html) : ''; };
function wizCapture() {
  const v = readForm(document.getElementById('wform'));
  if (!v) return false;
  ['mofFile', 'pacraFile', 'nrcFile'].forEach(k => {
    const file = document.querySelector(`#wform [name=${k}]`)?.files[0];
    if (file) W.blobs[k] = file;
    if (!v[k]) delete v[k];
  });
  Object.assign(W.data, v); return true;
}
function wizNext() {
  if (!wizCapture()) return;
  // The server needs the MoF reference and document together (or neither, to upload later).
  if (W.step === 2 && !!W.data.mofRef !== !!W.blobs.mofFile) {
    return wizError(W.data.mofRef ? 'Attach the MoF authorization document for the reference you entered, or clear the reference to upload both later.' : 'Enter the authorization reference for the MoF document you attached, or remove the document to upload both later.');
  }
  W.step++; renderWizard(); window.scrollTo({ top: 0, behavior: 'smooth' });
}
function wizPrev() { const form = document.getElementById('wform'); const v = {}; form.querySelectorAll('[name]').forEach(el => { if (el.type === 'radio') { if (el.checked) v[el.name] = el.value; } else if (el.type !== 'file' && el.type !== 'checkbox') v[el.name] = el.value.trim(); }); Object.assign(W.data, v); W.step--; renderWizard(); }

async function wizSubmit(btn) {
  if (!wizCapture()) return;
  const d = W.data, fd = new FormData();
  ['name', 'pacra', 'tpin', 'town', 'province', 'address', 'tier', 'contact', 'position', 'phone', 'email', 'director', 'directorNrc', 'mofRef'].forEach(k => fd.append(k, d[k] || ''));
  fd.append('declare', 'true');
  ['pacraFile', 'nrcFile', 'mofFile'].forEach(k => { if (W.blobs[k]) fd.append(k, W.blobs[k], W.blobs[k].name); });
  wizError('');
  busy(btn, true, 'Submitting…');
  let r;
  try {
    r = await pub('/applications', { method: 'POST', form: fd });
  } catch (e) {
    busy(btn, false);
    const fields = e instanceof ApiError ? e.fields : [];
    return wizError(fields.length ? `Please correct the following and resubmit:<ul class="mb-0 mt-1">${fields.map(f => `<li>${esc(f.message)}${f.field ? ` <span class="text-body-secondary">(${esc(f.field)})</span>` : ''}</li>`).join('')}</ul>` : esc(e.message));
  }
  saveTrackToken(r.ref, r.trackingToken);
  const hasMof = r.stage === 'MOF_REVIEW';
  document.getElementById('wizard').innerHTML = `<div class="text-center py-4">
    <span class="icon-circle xl bg-success-subtle text-success-emphasis mb-3">${icon('check-lg')}</span>
    <h2 class="h4">Application submitted</h2>
    <p class="text-body-secondary">Thank you, ${esc(d.contact)}. We’ve emailed a confirmation and your private tracking link to ${esc(d.email)}.</p>
    <div class="d-inline-block bg-body-tertiary rounded px-4 py-3 my-2"><div class="small text-body-secondary">Your application reference</div><div class="h3 fw-bold mb-0 font-monospace">${esc(r.ref)}</div></div>
    <div class="text-start mx-auto mt-4 mw-440"><div class="small fw-semibold mb-2">What happens next</div>
      <ol class="small text-body-secondary d-grid gap-1 ps-3 mb-0">
        ${hasMof ? '' : '<li>Upload your Ministry of Finance authorization from Track application.</li>'}
        <li>The Secretariat verifies your MoF authorization (1–2 working days).</li>
        <li>You pay the joining fee and first year’s dues online.</li>
        <li>Your accreditation certificate is issued automatically and your member portal is activated.</li>
      </ol></div>
    <div class="d-flex justify-content-center gap-2 mt-4"><a href="#/" class="btn btn-light">Back to home</a><a href="#/track/${encodeURIComponent(r.ref)}" class="btn btn-primary">Track application</a></div>
  </div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

expose({ wizNext, wizPrev, wizSubmit });

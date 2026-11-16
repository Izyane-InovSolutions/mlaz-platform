import { api } from '../../../core/api/client.js';
import { EL, expose, on } from '../../../core/events.js';
import { after } from '../../../core/navigation.js';
import { busy, esc, icon, note as alertBox, readForm } from '../../../shared/ui/index.js';

// The token comes from the address bar: checked against its exact format before it is used anywhere.
const isLinkToken = t => typeof t === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(t);

/* ================= SET PASSWORD (invite and reset links) ================= */
export function setPassword(_, query) {
  const raw = query?.get('token');
  const token = isLinkToken(raw) ? raw : null;
  // The link token is single-use and secret: take it out of the address bar (and history) straight away.
  if (raw) after(() => history.replaceState(null, '', '#/set-password'));
  const card = inner => `<section class="py-5 bg-body-tertiary min-vh-75 d-flex align-items-center"><div class="container"><div class="row justify-content-center"><div class="col-md-8 col-lg-5">
    <div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5" id="setpw">${inner}</div></div></div></div></div></section>`;
  if (!token) return card(`<h1 class="h4 mb-2">Set your password</h1><p class="small text-body-secondary mb-0">Open the link from your invitation or password-reset email. Links expire; <a href="#" role="button" ${on('click', 'forgotPassword')}>ask for a new one</a>.</p>`);
  return card(`<div class="text-center mb-4"><span class="brand-mark lg">${icon('key')}</span><h1 class="h4 mt-3 mb-1">Set your password</h1><p class="small text-body-secondary mb-0">Choose a password for your MLAZ account. Use at least 10 characters.</p></div>
    <div id="setpwerr"></div>
    <form novalidate ${on('submit', 'submitNewPassword', token, EL)}>
      <div class="mb-3"><label class="form-label small fw-medium">New password</label><input class="form-control form-control-lg" type="password" name="password" minlength="10" autocomplete="new-password" required><div class="invalid-feedback">Use at least 10 characters.</div></div>
      <div class="mb-4"><label class="form-label small fw-medium">Confirm password</label><input class="form-control form-control-lg" type="password" name="confirm" minlength="10" autocomplete="new-password" required><div class="invalid-feedback">Repeat the password.</div></div>
      <button class="btn btn-primary btn-lg w-100">Set password</button>
    </form>`);
}

async function submitNewPassword(token, form) {
  const v = readForm(form); if (!v) return;
  const errBox = document.getElementById('setpwerr');
  if (v.password !== v.confirm) { form.confirm.classList.add('is-invalid'); errBox.innerHTML = alertBox('danger', 'exclamation-circle', 'The passwords don’t match.'); return; }
  const btn = form.querySelector('button');
  busy(btn, true, 'Saving…');
  try {
    const r = await api('/auth/password/set', { method: 'POST', body: { token, password: v.password }, auth: false });
    document.getElementById('setpw').innerHTML = `<div class="text-center py-2">
      <span class="icon-circle lg bg-success-subtle text-success-emphasis mb-3">${icon('check-lg')}</span>
      <h1 class="h4">Password set</h1><p class="small text-body-secondary">You can now sign in as <b>${esc(r.email)}</b>.</p>
      <div class="d-flex justify-content-center gap-2"><a class="btn btn-primary" href="#/login/member">Member sign in</a><a class="btn btn-outline-secondary" href="#/login/admin">Secretariat sign in</a></div></div>`;
  } catch (e) {
    busy(btn, false);
    errBox.innerHTML = alertBox('danger', 'exclamation-circle', `${esc(e.message)}${e.code === 'BAD_REQUEST' ? ' <a href="#" role="button" data-on-click="forgotPassword">Send me a new link</a>.' : ''}`);
  }
}

expose({ submitNewPassword });

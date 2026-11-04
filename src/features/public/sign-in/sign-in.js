import { api } from '../../../core/api/client.js';
import { completeSignIn, signIn } from '../../../core/auth/session.js';
import { EL, expose, on } from '../../../core/events.js';
import { nav, rerender } from '../../../core/navigation.js';
import { busy, esc, icon, modal, note as alertBox, readForm, toast } from '../../../shared/ui/index.js';

/* ================= SIGN IN ================= */
const DEMO = { member: 'info@quicklend.zm', admin: 'secretariat@mlaz.org.zm' };
const DEMO_STAFF = [['secretariat@mlaz.org.zm', 'Secretariat Admin (approver)'], ['officer@mlaz.org.zm', 'Membership Officer'], ['finance@mlaz.org.zm', 'Finance Officer'], ['comms@mlaz.org.zm', 'Communications Officer']];

export function login(role) {
  role = role === 'admin' ? 'admin' : 'member';
  const member = role === 'member', dev = import.meta.env.DEV;
  return `<section class="py-5 bg-body-tertiary min-vh-75 d-flex align-items-center"><div class="container"><div class="row justify-content-center"><div class="col-md-8 col-lg-5">
    <div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5">
      <div class="text-center mb-4"><span class="brand-mark lg">${icon(member ? 'building' : 'person-badge')}</span><h1 class="h4 mt-3 mb-1">${member ? 'Member portal' : 'Secretariat sign in'}</h1><p class="small text-body-secondary mb-0">${member ? 'Manage your membership, dues and certificates.' : 'MLAZ staff access to the administration console.'}</p></div>
      <ul class="nav nav-pills nav-fill bg-body-tertiary rounded p-1 mb-4 small">
        <li class="nav-item"><a class="nav-link ${member ? 'active' : ''}" href="#/login/member">Member</a></li>
        <li class="nav-item"><a class="nav-link ${member ? '' : 'active'}" href="#/login/admin">Secretariat</a></li>
      </ul>
      <div id="loginerr"></div>
      <form ${on('submit', 'doLogin', role, EL)} novalidate>
        <div class="mb-3"><label class="form-label small fw-medium">Email address</label><input class="form-control form-control-lg" type="email" name="email" value="${dev ? DEMO[role] : ''}" autocomplete="username" required></div>
        <div class="mb-3"><label class="form-label small fw-medium">Password</label><input class="form-control form-control-lg" type="password" name="password" autocomplete="current-password" required></div>
        <div class="d-flex justify-content-between align-items-center mb-4 small">
          <div class="form-check"><input class="form-check-input" type="checkbox" name="remember" id="remember"><label class="form-check-label" for="remember">Keep me signed in</label></div>
          <a href="#" role="button" ${on('click', 'forgotFromLogin', EL)}>Forgot password?</a>
        </div>
        <button class="btn btn-primary btn-lg w-100">Sign in</button>
      </form>
      ${member ? '<p class="text-center small mt-4 mb-0 text-body-secondary">Not a member yet? <a href="#/apply">Apply for membership</a></p>' : ''}
      ${dev ? `<div class="small text-body-secondary mt-4 border-top pt-3"><div class="fw-medium mb-1">${icon('tools', 'me-1')}Demo accounts (development only)</div>
        ${member ? `<div>${DEMO.member} · or any seeded member email</div>` : DEMO_STAFF.map(([e, t]) => `<div>${e} · ${t}</div>`).join('')}
        <div class="mt-1">Password: the seed password (<span class="font-monospace">Mlaz@2026demo</span> by default)</div></div>` : ''}
    </div></div>
  </div></div></div></section>`;
}

async function doLogin(role, form) {
  const email = form.email.value.trim().toLowerCase(), pwd = form.password.value, btn = form.querySelector('button.btn-primary');
  const err = msg => { document.getElementById('loginerr').innerHTML = alertBox('danger', 'exclamation-circle', msg); };
  if (!email || !pwd) return err('Enter your email address and password.');
  busy(btn, true, 'Signing in…');
  try {
    const s = await signIn(email, pwd, role === 'admin' ? 'staff' : 'member', form.remember.checked);
    if (s.mfaRequired) return showMfaStep(role, s.mfaToken, form, s.method);
    await afterSignIn(role, s, btn, err);
  } catch (e) {
    busy(btn, false);
    const other = role === 'admin' ? '<a href="#/login/member">Use the member sign-in instead</a>.' : '<a href="#/login/admin">Use the Secretariat sign-in instead</a>.';
    err(`${esc(e.message)}${e.code === 'WRONG_PORTAL' ? ` ${other}` : ''}`);
  }
}

function afterSignIn(role, s) {
  if (role === 'admin' && s.mfaSetupRequired) return nav('secure-account');
  nav(role === 'admin' ? 'app/dashboard' : 'app/overview');
}

// Second step: the authenticator app (accounts with two-factor sign-in), or a code emailed by the server because the
// account has seen repeated failed sign-ins and this browser has not signed in to it before. The intermediate token
// stays in this closure only.
function showMfaStep(role, mfaToken, form, method = 'totp') {
  const err = msg => { document.getElementById('loginerr').innerHTML = alertBox('danger', 'exclamation-circle', msg); };
  const emailed = method === 'email';
  document.getElementById('loginerr').innerHTML = emailed
    ? alertBox('warning', 'shield-exclamation', 'There have been repeated failed attempts to sign in to this account, so signing in from a new device needs a code. We’ve emailed one to the account’s address.')
    : '';
  form.outerHTML = `<form id="mfaform" novalidate>
    <p class="small text-body-secondary">${emailed
      ? 'Enter the 6-digit sign-in code from the email. It is valid for 10 minutes. No email? Check your spam folder, or start again for a new code.'
      : 'Enter the 6-digit code from your authenticator app. Lost your phone? Enter one of your recovery codes instead.'}</p>
    <div class="mb-4"><label class="form-label small fw-medium" for="mfacode">${emailed ? 'Sign-in code' : 'Authentication code'}</label>
      <input class="form-control form-control-lg text-center font-monospace" id="mfacode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required autofocus></div>
    <button class="btn btn-primary btn-lg w-100">Verify</button>
    <div class="text-center mt-3"><a class="small" href="#/login/${role === 'admin' ? 'admin' : 'member'}" ${on('click', 'rerenderSoon')}>Start again</a></div></form>`;
  const f = document.getElementById('mfaform');
  f.code.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const code = f.code.value.trim(), btn = f.querySelector('button');
    if (!code) return f.code.classList.add('is-invalid');
    busy(btn, true, 'Verifying…');
    try { await afterSignIn(role, await completeSignIn(mfaToken, code, role === 'admin' ? 'staff' : 'member'), btn, err); }
    catch (ex) {
      busy(btn, false); f.code.value = ''; f.code.focus();
      err(ex.status === 401 && ex.code !== 'INVALID_CODE' ? `${esc(ex.message)} <a href="#/login/${encodeURIComponent(role)}" ${on('click', 'rerenderSoon')}>Sign in again</a>.` : esc(ex.message));
    }
  };
}

const forgotFromLogin = link => forgotPassword(link.closest('form').email.value);
function forgotPassword(prefill = '') {
  const el = modal({
    title: 'Reset your password',
    body: `<p class="small text-body-secondary">Enter the email you sign in with. If it has an account, we’ll email a link to set a new password (valid for 1 hour).</p>
      <form novalidate><input class="form-control" type="email" name="email" value="${esc(prefill)}" required aria-label="Email address" placeholder="you@example.zm"><div class="invalid-feedback">Enter a valid email address.</div></form>`,
    footer: '<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" data-ok>Send reset link</button>',
  });
  const send = async () => {
    const v = readForm(el.querySelector('form')); if (!v) return;
    const btn = el.querySelector('[data-ok]');
    busy(btn, true, 'Sending…');
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email: v.email }, auth: false });
      el.close(); toast('If that email has an account, a reset link is on its way');
    } catch (e) { busy(btn, false); toast(e.message, 'error'); }
  };
  el.querySelector('[data-ok]').onclick = send;
  el.querySelector('form').onsubmit = e => { e.preventDefault(); send(); };
}

const rerenderSoon = () => setTimeout(rerender); // after a link to the page already shown

expose({ doLogin, forgotPassword, forgotFromLogin, rerenderSoon });

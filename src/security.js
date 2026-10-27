// Account security screens shared by the console and the portal: two-factor sign-in, recovery codes, password change
// and "sign out everywhere". Secrets shown here (the TOTP key, recovery codes) are displayed once and never stored.
import QRCode from 'qrcode';
import { adoptSession, api, ensureSession, refreshSession, signOutEverywhere } from './api.js';
import { asyncModal, esc, expose, getSession, icon, modal, nav, rerender, toast } from './ui.js';

function showRecoveryCodes(codes, onDone = () => {}) {
  const text = `MLAZ recovery codes for ${getSession()?.email}\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const el = modal({
    title: 'Save your recovery codes',
    body: `<p class="small">If you lose your phone, each of these codes lets you sign in once. Store them somewhere safe (a password manager or printed). <b>They won’t be shown again.</b></p>
      <div class="bg-body-tertiary rounded p-3 font-monospace d-grid gap-1 text-center" style="grid-template-columns:1fr 1fr">${codes.map(c => `<span>${esc(c)}</span>`).join('')}</div>`,
    footer: `<a class="btn btn-light me-auto" href="${url}" download="mlaz-recovery-codes.txt">${icon('download', 'me-1')} Download</a><button class="btn btn-primary" data-bs-dismiss="modal">I’ve saved them</button>`,
  });
  el.addEventListener('hidden.bs.modal', () => { URL.revokeObjectURL(url); onDone(); });
}

/** Two-factor enrolment: scan the QR code (or type the key), confirm with a code, then save recovery codes. */
export async function enrolMfa(onDone = () => rerender()) {
  let setup;
  try { setup = await api('/auth/mfa/setup', { method: 'POST' }); } catch (e) { return toast(e.message, 'error'); }
  const qr = await QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 });
  asyncModal({
    title: 'Set up two-factor sign-in', confirmText: 'Turn on', busyText: 'Checking…',
    body: `<ol class="small ps-3"><li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</li><li>Scan this code, or enter the key by hand.</li><li>Type the 6-digit code it shows.</li></ol>
      <div class="text-center mb-3"><img src="${qr}" alt="QR code for your authenticator app" width="220" height="220" class="border rounded p-2"></div>
      <div class="small text-center text-body-secondary mb-3">Key: <span class="font-monospace user-select-all">${esc(setup.secret.replace(/(.{4})/g, '$1 ').trim())}</span></div>
      <label class="form-label small fw-medium">6-digit code</label><input class="form-control form-control-lg text-center font-monospace" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required><div class="invalid-feedback">Enter the 6-digit code.</div>`,
    onSubmit: async v => {
      const r = await api('/auth/mfa/confirm', { method: 'POST', body: { code: v.code } });
      await refreshSession(); // a set-up-only session becomes a full one
      setTimeout(() => showRecoveryCodes(r.recoveryCodes, onDone), 350);
    },
  });
}

function disableMfa() {
  asyncModal({
    title: 'Turn off two-factor sign-in', confirmText: 'Turn off', tone: 'danger',
    body: `<p class="small text-body-secondary">Your account will be protected by your password only.</p>
      <div class="mb-3"><label class="form-label small fw-medium">Password</label><input class="form-control" type="password" name="password" autocomplete="current-password" required></div>
      <label class="form-label small fw-medium">Code from your authenticator app</label><input class="form-control font-monospace" name="code" inputmode="numeric" autocomplete="one-time-code" required>`,
    onSubmit: async v => { await api('/auth/mfa/disable', { method: 'POST', body: v }); await refreshSession(); toast('Two-factor sign-in turned off'); rerender(); },
  });
}

function newRecoveryCodes() {
  asyncModal({
    title: 'New recovery codes', confirmText: 'Generate',
    body: '<p class="small text-body-secondary">Your old recovery codes stop working.</p><label class="form-label small fw-medium">Code from your authenticator app</label><input class="form-control font-monospace" name="code" inputmode="numeric" autocomplete="one-time-code" required>',
    onSubmit: async v => { const r = await api('/auth/mfa/recovery-codes', { method: 'POST', body: v }); setTimeout(() => showRecoveryCodes(r.recoveryCodes), 350); },
  });
}

function changePassword() {
  asyncModal({
    title: 'Change password', confirmText: 'Change password',
    body: `<div class="mb-3"><label class="form-label small fw-medium">Current password</label><input class="form-control" type="password" name="currentPassword" autocomplete="current-password" required></div>
      <div class="mb-3"><label class="form-label small fw-medium">New password</label><input class="form-control" type="password" name="newPassword" minlength="10" autocomplete="new-password" required><div class="invalid-feedback">At least 10 characters.</div></div>
      <label class="form-label small fw-medium">Repeat new password</label><input class="form-control" type="password" name="confirm" minlength="10" autocomplete="new-password" required>
      <div class="form-text">You’ll stay signed in here; every other device is signed out.</div>`,
    onSubmit: async v => {
      if (v.newPassword !== v.confirm) throw new Error('The new passwords don’t match.');
      const r = await api('/auth/password/change', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword, remember: !!getSession()?.remember } });
      adoptSession(r);
      toast('Password changed. Other devices have been signed out');
    },
  });
}

function signOutAll() {
  asyncModal({
    title: 'Sign out everywhere', confirmText: 'Sign out everywhere', tone: 'danger',
    body: '<p class="mb-0">End every session of your account on every device, including this one? Use this if a device was lost or you think someone else signed in.</p>',
    onSubmit: async () => {
      const admin = getSession()?.role === 'admin';
      await signOutEverywhere();
      toast('Signed out everywhere');
      nav(admin ? 'login/admin' : 'login/member');
    },
  });
}

/** "Your account" card for settings pages. */
export function accountCard() {
  const s = getSession();
  return `<div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">${icon('shield-lock', 'me-1')}Your account</h2></div><div class="list-group list-group-flush">
    <div class="list-group-item d-flex flex-wrap align-items-center gap-2 py-3"><div class="flex-grow-1 min-w-0"><div class="fw-medium">Two-factor sign-in</div><div class="small text-body-secondary">${s?.mfaEnabled ? 'On: a code from your phone is needed at each sign-in' : 'Off: protect your account with a code from your phone'}</div></div>
      ${s?.mfaEnabled ? '<button class="btn btn-sm btn-outline-secondary" onclick="newRecoveryCodes()">New recovery codes</button><button class="btn btn-sm btn-outline-danger" onclick="disableMfa()">Turn off</button>' : '<button class="btn btn-sm btn-primary" onclick="enrolMfa()">Turn on</button>'}</div>
    <div class="list-group-item d-flex align-items-center gap-3 py-3"><div class="flex-grow-1 min-w-0"><div class="fw-medium">Password</div><div class="small text-body-secondary text-truncate">${esc(s?.email)}</div></div><button class="btn btn-sm btn-outline-secondary" onclick="changePassword()">Change</button></div>
    <div class="list-group-item d-flex align-items-center gap-3 py-3"><div class="flex-grow-1"><div class="fw-medium">Sessions</div><div class="small text-body-secondary">Sign out of every device at once</div></div><button class="btn btn-sm btn-outline-danger" onclick="signOutAll()">Sign out everywhere</button></div>
  </div></div>`;
}

/** Shown when two-factor sign-in is required for staff and this account has not enrolled yet. */
export async function secureAccountPage() {
  if (!(await ensureSession())) { setTimeout(() => nav('login/admin')); return ''; }
  if (!getSession()?.mfaSetupRequired) { setTimeout(() => nav('app/dashboard')); return ''; }
  return `<section class="py-5 bg-body-tertiary min-vh-75 d-flex align-items-center"><div class="container"><div class="row justify-content-center"><div class="col-md-8 col-lg-5">
    <div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5 text-center">
      <span class="brand-mark lg">${icon('shield-lock')}</span>
      <h1 class="h4 mt-3 mb-2">Secure your account</h1>
      <p class="small text-body-secondary">MLAZ requires two-factor sign-in for Secretariat accounts, because the console holds applicants’ identity documents and financial records. It takes about a minute.</p>
      <button class="btn btn-primary btn-lg w-100 mt-2" onclick="enrolMfa(()=>nav('app/dashboard'))">Set up two-factor sign-in</button>
      <button class="btn btn-link btn-sm mt-3" onclick="logout()">Sign out</button>
    </div></div></div></div></div></section>`;
}

expose({ enrolMfa, disableMfa, newRecoveryCodes, changePassword, signOutAll });

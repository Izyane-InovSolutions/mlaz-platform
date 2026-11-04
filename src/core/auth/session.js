// Signing in and out. Display details and the in-memory token live in session-store.js; restoring a session after a
// reload is part of the API client (it is what a request does when it has no token).
import { api } from '../api/client.js';
import { adopt, getSession, setAccessToken, setSession } from './session-store.js';

export { ensureSession, refreshSession } from '../api/client.js';
export { getSession, setSession } from './session-store.js';

const roleFor = portal => (portal === 'staff' ? 'admin' : 'member');

/**
 * Signs in. Returns the session, or { mfaRequired, mfaToken, method } when a second step is needed: 'totp' for the
 * authenticator app, or 'email' for a code the server emailed because the account is seeing repeated failed sign-ins
 * and this browser has not signed in to it before. Finish with completeSignIn(). portal: 'staff' | 'member'.
 */
export async function signIn(email, password, portal, remember) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password, portal, remember: !!remember }, auth: false });
  if (r.mfaRequired) return { mfaRequired: true, mfaToken: r.mfaToken, method: r.method === 'email' ? 'email' : 'totp' };
  return adopt(r, { role: roleFor(portal) });
}

export async function completeSignIn(mfaToken, code, portal) {
  const r = await api('/auth/login/mfa', { method: 'POST', body: { mfaToken, code }, auth: false });
  return adopt(r, { role: roleFor(portal) });
}

/** Takes over a new session the server issued (e.g. after changing the password). */
export const adoptSession = r => adopt(r, getSession() || {});

export async function signOut() {
  setAccessToken(null);
  setSession(null);
  await api('/auth/logout', { method: 'POST', auth: false }).catch(() => {});
}

export async function signOutEverywhere() {
  await api('/auth/logout-all', { method: 'POST' });
  setAccessToken(null);
  setSession(null);
}

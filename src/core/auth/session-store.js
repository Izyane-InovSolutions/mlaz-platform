// What the browser keeps about the signed-in user.
// - the refresh token is an httpOnly cookie the browser sends only to /api/auth; page scripts can never read it;
// - the short-lived access token is kept in memory only, in this module (a reload gets a fresh one from the cookie);
// - browser storage holds only display details (name, role, permissions), never a secret.

// Display details of the signed-in user (no tokens: see api.js) live in sessionStorage, or in localStorage when
// "Keep me signed in" is ticked.
const SKEY = 'mlaz-session';
export function getSession() {
  try { return JSON.parse(sessionStorage.getItem(SKEY) || localStorage.getItem(SKEY)); } catch (e) { return null; }
}
export function setSession(s, remember = s?.remember) {
  try {
    sessionStorage.removeItem(SKEY); localStorage.removeItem(SKEY);
    if (s) (remember ? localStorage : sessionStorage).setItem(SKEY, JSON.stringify(s));
  } catch (e) { /* storage blocked: the session only lasts until reload */ }
}

let accessToken = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = token => { accessToken = token; };

/** Saves what the UI needs to show about the signed-in user. Tokens are deliberately not part of it. */
export function adopt(r, base = {}) {
  accessToken = r.accessToken;
  const u = r.user;
  const session = {
    ...base,
    role: base.role || (u.permissions.length ? 'admin' : 'member'),
    email: u.email, name: u.name, title: u.roleLabel, userId: u.id, permissions: u.permissions,
    memberId: u.member?.number ?? null, memberName: u.member?.name ?? null,
    mfaEnabled: u.mfaEnabled, mfaSetupRequired: !!r.mfaSetupRequired,
    remember: !!r.remember,
  };
  setSession(session, session.remember);
  return session;
}

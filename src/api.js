// Client for the MLAZ API (see server/README.md).
//
// Where credentials live:
// - the refresh token is an httpOnly cookie the browser sends only to /api/auth; page scripts can never read it;
// - the short-lived access token is kept in memory only (a reload gets a fresh one from the cookie);
// - browser storage holds only display details (name, role, permissions), never a secret.
import { getSession, setSession } from './ui.js';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
  /** Field-level validation messages from the server, if any. */
  get fields() { return this.details?.fields || []; }
}

let accessToken = null;

async function send(path, { method = 'GET', body, form, headers = {}, auth = true }) {
  const authCall = path.startsWith('/auth/');
  const h = { ...headers, ...(authCall && { 'x-mlaz-csrf': '1' }) };
  if (auth && accessToken) h.authorization = `Bearer ${accessToken}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  try {
    return await fetch(API_URL + path, {
      method, headers: h, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      credentials: authCall ? 'include' : 'omit', // the session cookie only ever travels to /auth
    });
  } catch (e) {
    throw new ApiError(0, 'NETWORK', 'We couldn’t reach the MLAZ server. Check your connection and try again.');
  }
}

async function toError(res) {
  let e = {};
  try { e = (await res.json()).error || {}; } catch (_) { /* not JSON */ }
  return new ApiError(res.status, e.code || `HTTP_${res.status}`, e.message || 'Something went wrong. Please try again.', e.details);
}

/** Saves what the UI needs to show about the signed-in user. Tokens are deliberately not part of it. */
function adopt(r, base = {}) {
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

// One refresh at a time, even if several calls need a token together. Across tabs too: the refresh token rotates, and
// the server treats the same token arriving twice as theft (ending every session), so two tabs refreshing at once
// would sign the user out. The Web Locks API queues them; the second tab then sends the already-rotated cookie.
let refreshing = null;
const acrossTabs = fn => (navigator.locks ? navigator.locks.request('mlaz-session-refresh', fn) : fn());
export function refreshSession() {
  const s = getSession();
  if (!s) return Promise.resolve(false);
  refreshing ??= acrossTabs(() => send('/auth/refresh', { method: 'POST', body: { remember: !!s.remember }, auth: false }))
    .then(async res => {
      if (!res.ok) { accessToken = null; setSession(null); return false; }
      adopt(await res.json(), getSession() || s);
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

/** True when there is a usable session, restoring it from the cookie after a page load. */
export async function ensureSession() {
  if (!getSession()) return false;
  return accessToken ? true : refreshSession();
}

/**
 * Calls the API. Options: method, body (JSON), form (FormData), headers, auth (send the session token; default true),
 * raw (return the Response, e.g. for file downloads).
 */
export async function api(path, opts = {}) {
  if (opts.auth !== false && getSession() && !accessToken) await refreshSession();
  let res = await send(path, opts);
  if (res.status === 401 && opts.auth !== false && getSession()) {
    if (await refreshSession()) res = await send(path, opts);
  }
  if (!res.ok) throw await toError(res);
  if (opts.raw) return res;
  return res.status === 204 ? null : res.json();
}

/** Public endpoints never send the session token. */
export const pub = (path, opts = {}) => api(`/public${path}`, { ...opts, auth: false });

/** Downloads a file response (PDF, CSV) and saves it with the server's filename. */
export async function download(path, opts = {}) {
  const res = await api(path, { ...opts, raw: true });
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'download';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ================= SESSION ================= */

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
  accessToken = null;
  setSession(null);
  await send('/auth/logout', { method: 'POST', auth: false }).catch(() => {});
}

export async function signOutEverywhere() {
  await api('/auth/logout-all', { method: 'POST' });
  accessToken = null;
  setSession(null);
}

export const can = permission => !!getSession()?.permissions?.includes(permission);

/* ================= PUBLIC REFERENCE DATA ================= */

// Tiers, fees, provinces and payment methods change rarely; fetch them once per page load.
let config = null;
export function publicConfig() {
  config ??= pub('/config').catch(e => { config = null; throw e; });
  return config;
}

/* ================= APPLICATION TRACKING TOKENS ================= */

// The tracking token from the application confirmation (or the emailed link), remembered in this browser per reference.
// It only opens that one application's status page, and is never sent anywhere but the API.
const TRACK_KEY = 'mlaz-track';
export const isTrackingToken = t => typeof t === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(t);
const trackMap = () => { try { return JSON.parse(localStorage.getItem(TRACK_KEY)) || {}; } catch (e) { return {}; } };
export const trackToken = ref => { const t = trackMap()[ref]; return isTrackingToken(t) ? t : null; };
export function saveTrackToken(ref, token) {
  if (!isTrackingToken(token)) return;
  try { localStorage.setItem(TRACK_KEY, JSON.stringify({ ...trackMap(), [ref]: token })); } catch (e) { /* ignore */ }
}
export function forgetTrackToken(ref) {
  const m = trackMap(); delete m[ref];
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ }
}

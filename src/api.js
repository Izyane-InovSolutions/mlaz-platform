// Client for the MLAZ API (see server/README.md). Signed-in calls carry the access token from the session and
// refresh it automatically once when it expires. Errors come back as ApiError with the server's code and message.
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

async function send(path, { method = 'GET', body, form, headers = {}, auth = true }) {
  const h = { ...headers };
  const token = auth && getSession()?.tokens?.accessToken;
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  try {
    return await fetch(API_URL + path, { method, headers: h, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch (e) {
    throw new ApiError(0, 'NETWORK', 'We couldn’t reach the MLAZ server. Check your connection and try again.');
  }
}

async function toError(res) {
  let e = {};
  try { e = (await res.json()).error || {}; } catch (_) { /* not JSON */ }
  return new ApiError(res.status, e.code || `HTTP_${res.status}`, e.message || 'Something went wrong. Please try again.', e.details);
}

// One refresh at a time, even if several calls hit an expired token together.
let refreshing = null;
function refreshSession() {
  const s = getSession();
  if (!s?.tokens?.refreshToken) return Promise.resolve(false);
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: s.tokens.refreshToken }) })
    .then(async res => {
      if (!res.ok) return false;
      const r = await res.json();
      setSession({ ...getSession(), tokens: { accessToken: r.accessToken, refreshToken: r.refreshToken } });
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * Calls the API. Options: method, body (JSON), form (FormData), headers, auth (send the session token; default true),
 * raw (return the Response, e.g. for file downloads).
 */
export async function api(path, opts = {}) {
  let res = await send(path, opts);
  if (res.status === 401 && opts.auth !== false && getSession()?.tokens) {
    if (await refreshSession()) res = await send(path, opts);
    else setSession(null); // the session has ended; the router sends the user back to sign in
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

/** Signs in and stores the session. portal: 'staff' | 'member'. */
export async function signIn(email, password, portal, remember) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password, portal }, auth: false });
  const u = r.user;
  const session = {
    role: portal === 'staff' ? 'admin' : 'member',
    email: u.email, name: u.name, title: u.roleLabel, userId: u.id, permissions: u.permissions,
    memberId: u.member?.number ?? null, memberName: u.member?.name ?? null,
    tokens: { accessToken: r.accessToken, refreshToken: r.refreshToken }, remember: !!remember,
  };
  setSession(session, remember);
  return session;
}

export async function signOut() {
  const refreshToken = getSession()?.tokens?.refreshToken;
  setSession(null);
  if (refreshToken) await api('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => {});
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
const TRACK_KEY = 'mlaz-track';
const trackMap = () => { try { return JSON.parse(localStorage.getItem(TRACK_KEY)) || {}; } catch (e) { return {}; } };
export const trackToken = ref => trackMap()[ref] || null;
export function saveTrackToken(ref, token) {
  try { localStorage.setItem(TRACK_KEY, JSON.stringify({ ...trackMap(), [ref]: token })); } catch (e) { /* ignore */ }
}
export function forgetTrackToken(ref) {
  const m = trackMap(); delete m[ref];
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ }
}

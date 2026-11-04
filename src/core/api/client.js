// Client for the MLAZ API (see server/README.md). The only module that calls fetch(): which credentials travel with a
// request, the error format, and the refresh-and-retry when the access token has expired are all decided here.
import { adopt, getAccessToken, getSession, setAccessToken, setSession } from '../auth/session-store.js';
import { safeFilename } from '../html.js';

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
  const authCall = path.startsWith('/auth/');
  const h = { ...headers, ...(authCall && { 'x-mlaz-csrf': '1' }) };
  if (auth && getAccessToken()) h.authorization = `Bearer ${getAccessToken()}`;
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
      if (!res.ok) { setAccessToken(null); setSession(null); return false; }
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
  return getAccessToken() ? true : refreshSession();
}

/**
 * Calls the API. Options: method, body (JSON), form (FormData), headers, auth (send the session token; default true),
 * raw (return the Response, e.g. for file downloads).
 */
export async function api(path, opts = {}) {
  if (opts.auth !== false && getSession() && !getAccessToken()) await refreshSession();
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
  // The filename comes from the server's header: stripped of path separators and control characters before use.
  const name = safeFilename(/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1]);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

import { pub } from './api/client.js';

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

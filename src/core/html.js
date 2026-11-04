// HTML escaping, the base of the UI's one rule for markup: every value that did not come from this source code goes
// through esc() before it reaches innerHTML or an attribute (docs/frontend-architecture.md).
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// URL checking, the second rule: every URL put in an href or src, or opened, goes through safeUrl() first (and then
// esc(), like any attribute value). It returns the URL when it is one of the allowed kinds, otherwise '' (so a link or
// image is simply not shown). Kinds, as a space-separated list, default all of them:
//   https   an absolute https: URL (a payment gateway's checkout page). The only kind allowed for checkoutUrl.
//   self    a same-origin URL: a #/route, an /absolute path, or this page's own origin (stylesheets for printDoc).
//   blob    an object URL this page created (blob:<this origin>/…): downloads and document previews.
//   png     a base64 PNG data: URL (QR codes generated in the browser).
// Never javascript:, data: of any other type, http:, protocol-relative //host or a backslash trick (/\host).
const controlOrSpace = c => c.charCodeAt(0) <= 0x20 || (c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f);
const origin = () => globalThis.location?.origin || 'null';
const parse = u => { try { return new URL(u); } catch (_) { return null; } };
const KINDS = {
  https: u => /^https:\/\/[^/\\]/i.test(u) && parse(u)?.protocol === 'https:',
  self: u => /^#/.test(u) || /^\/(?![/\\])/.test(u) || (origin() !== 'null' && parse(u)?.origin === origin() && /^https?:$/.test(parse(u).protocol)),
  blob: u => origin() !== 'null' && u.startsWith(`blob:${origin()}/`),
  png: u => /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(u),
};
export function safeUrl(url, kinds = 'https self blob png') {
  // Control characters and whitespace are dropped by URL parsers ("java\nscript:"), so any of them rejects the URL.
  if (typeof url !== 'string' || !url || [...url].some(controlOrSpace)) return '';
  return kinds.split(' ').some(k => KINDS[k]?.(url)) ? url : '';
}

/** A filename for a download attribute: no path separators, control characters or leading dots, at most 120 chars. */
export const safeFilename = (name, fallback = 'download') =>
  [...String(name ?? '')].map(c => ((controlOrSpace(c) && c !== ' ') || '/\\:*?"<>|'.includes(c) ? '_' : c)).join('').replace(/^[.\s]+/, '').slice(0, 120) || fallback;

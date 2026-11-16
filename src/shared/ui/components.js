import { esc, initials } from './format.js';

// Icon names are Bootstrap Icons names; anything else is stripped, so even a name from the API stays one class.
// Decorative: the glyph is CSS content, which screen readers would otherwise read out as part of a button's name
// (and which then hides the button's title). A button that is only an icon names itself with title or aria-label.
export const icon = (n, cls = '') => `<i class="bi bi-${String(n).replace(/[^a-z0-9-]/g, '')} ${cls}" aria-hidden="true"></i>`;
export const badge = (text, tone) => `<span class="badge rounded-pill bg-${tone}-subtle text-${tone}-emphasis border border-${tone}-subtle">${text}</span>`;
// Avatar colours are a fixed set of classes (.ava-0 to .ava-7 in styles.scss): the CSP allows no inline styles.
export const avatar = (name, i, lg) => `<span class="avatar ava-${(Math.abs(Math.trunc(Number(i))) || 0) % 8} ${lg ? 'lg' : ''}">${esc(initials(name))}</span>`;
/** The class for a bar's width, .pct-0 to .pct-100 (styles.scss): a percentage clamped and rounded, never markup. */
export const pctClass = n => `pct-${Math.max(0, Math.min(100, Math.round(Number(n) || 0)))}`;

export const pageHeader = (title, sub, actions = '', crumbs = '') => `
  ${crumbs ? `<nav aria-label="breadcrumb"><ol class="breadcrumb small mb-2">${crumbs}</ol></nav>` : ''}
  <div class="d-flex flex-wrap align-items-start gap-3 mb-4">
    <div class="me-auto"><h1 class="h3 mb-1">${title}</h1>${sub ? `<p class="text-body-secondary mb-0">${sub}</p>` : ''}</div>
    ${actions ? `<div class="d-flex flex-wrap gap-2">${actions}</div>` : ''}
  </div>`;

export const statCard = (label, value, sub, ic, tone = 'primary') => `
  <div class="card h-100"><div class="card-body"><div class="d-flex justify-content-between gap-2">
    <div><div class="small text-body-secondary fw-medium">${label}</div><div class="${String(value).startsWith('<span') ? 'fs-6 mt-2 mb-1' : 'fs-3 fw-semibold mt-1 lh-sm'}">${value}</div>${sub ? `<div class="small text-body-secondary mt-1">${sub}</div>` : ''}</div>
    <div class="stat-icon bg-${tone}-subtle text-${tone}-emphasis">${icon(ic)}</div>
  </div></div></div>`;

export const stepper = (steps, idx) => `<ol class="stepper">${steps.map((s, i) =>
  `<li class="${i < idx ? 'done' : i === idx ? 'active' : ''}"><span class="dot">${i < idx ? icon('check-lg') : i + 1}</span><span class="label">${s}</span></li>`).join('')}</ol>`;

export const empty = (text, ic = 'inbox') => `<div class="text-center text-body-secondary py-5">${icon(ic, 'fs-2 d-block mb-2 opacity-50')}<div class="small">${text}</div></div>`;

export const listItem = (ic, tone, title, sub, right = '') => `
  <div class="list-group-item d-flex align-items-center gap-3 py-3">
    <span class="icon-circle bg-${tone}-subtle text-${tone}-emphasis">${icon(ic)}</span>
    <div class="flex-grow-1 min-w-0"><div class="fw-medium">${title}</div>${sub ? `<div class="small text-body-secondary">${sub}</div>` : ''}</div>
    ${right}
  </div>`;

export const note = (tone, ic, html, cls = '') => `<div class="alert alert-${tone} small d-flex gap-2 ${cls}">${icon(ic)}<div>${html}</div></div>`;
export const infoRow = (k, v) => `<div class="d-flex justify-content-between gap-3 py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v ?? '—'}</span></div>`;

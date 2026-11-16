export { esc, safeFilename, safeUrl } from '../../core/html.js';

export const initials = s => String(s ?? '').split(' ').map(w => w[0]).filter(x => /[A-Za-z]/.test(x || '')).slice(0, 2).join('').toUpperCase();
export const K = n => 'K' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const KM = n => n >= 1e6 ? 'K' + (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? 'K' + Math.round(n / 1000) + 'k' : K(n);
export const today = () => new Date().toISOString().slice(0, 10);
export const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const lower = s => String(s || '').toLowerCase();

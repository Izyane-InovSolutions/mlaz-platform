import { api } from '../../../core/api/client.js';

// Secretariat console. Every page loads from the API (/api/admin) and every action goes through it; buttons a role
// may not use are hidden, and the server enforces the same permissions regardless.

export const adm = (path, opts) => api(`/admin${path}`, opts);
export const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); }); const s = p.toString(); return s ? `?${s}` : ''; };

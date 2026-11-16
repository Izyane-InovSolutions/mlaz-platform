// Status badges for membership, accreditation, MoF authorizations, applications and payments.
import { badge, esc } from '../../shared/ui/index.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const statusBadge = s => badge(cap(esc(s)), { active: 'success', lapsed: 'warning', suspended: 'danger' }[s] || 'secondary');
export const tierBadge = t => `<span class="badge rounded-pill tier tier-${esc(t)}">${esc(t)}</span>`;
export const accredBadge = a => badge(cap(esc(a)), { issued: 'success', expired: 'warning', revoked: 'danger' }[a] || 'secondary');
export const mofBadge = s => badge(cap(esc(s)), s === 'valid' ? 'success' : 'danger');
const STAGES = {
  details: ['Awaiting documents', 'secondary'], mof_review: ['MoF review', 'warning'], mof_approval: ['Awaiting approval', 'primary'],
  payment_pending: ['Payment pending', 'info'], accredited: ['Accredited', 'success'], rejected: ['Not approved', 'danger'],
};
export const stageBadge = s => { const [t, tone] = STAGES[s] || ['Unknown', 'secondary']; return badge(t, tone); };
export const payBadge = s => badge(cap(esc(s)), { success: 'success', pending: 'warning', failed: 'danger', cancelled: 'secondary' }[s] || 'secondary');

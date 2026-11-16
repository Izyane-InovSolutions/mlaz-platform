import { EL, on } from '../../../core/events.js';
import { K, badge, empty, esc, fmtDate, fmtDateTime, icon, listItem, lower, statCard } from '../../../shared/ui/index.js';
import { ACTIVITY, accredBadge, mofBadge, statusBadge } from '../../common/index.js';
import { portal } from '../shared/api.js';

const duesBadge = d => d.overdue ? badge('Overdue', 'danger') : d.payable ? badge('Due', 'warning') : badge('Paid', 'success');

/* ================= OVERVIEW ================= */
export async function overview() {
  const o = await portal('/overview'), m = o.member;
  return `<div class="card band-dark border-0 shadow-sm mb-4"><div class="card-body p-4">
      <h1 class="h4 mb-1">${esc(m.name)}</h1><div class="small opacity-75">Member ${esc(m.number)} · ${esc(m.tier)} tier · ${esc(m.town)}</div>
    </div></div>`
    + o.alerts.map(a => `<div class="alert alert-${{ danger: 'danger', warning: 'warning' }[a.level] || 'info'} d-flex align-items-center gap-2">${icon(a.level === 'danger' ? 'exclamation-octagon' : 'info-circle')}<div class="me-auto">${esc(a.message)}</div>
        ${a.code === 'DUES_PAYABLE' || a.code === 'LAPSED' ? '<a class="btn btn-sm btn-warning" href="#/app/dues">Pay now</a>' : a.code === 'MOF_EXPIRED' ? '<a class="btn btn-sm btn-light" href="#/app/certificates">Upload</a>' : ''}</div>`).join('')
    + `<div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('Membership', statusBadge(lower(m.status)), m.goodStanding ? 'In good standing' : 'Not in good standing', 'person-check', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('MoF authorization', m.pendingRenewal ? badge('Renewal pending', 'warning') : mofBadge(lower(m.mofStatus)), `${esc(m.mofRef)}${m.mofExpiry ? ` · expires ${fmtDate(m.mofExpiry)}` : ''}`, 'file-earmark-check', 'info')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Accreditation', accredBadge(lower(m.accreditation)), `Valid until ${fmtDate(m.validUntil)}`, 'award', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Annual dues', duesBadge(m.dues), m.dues.payable ? `${K(m.dues.amount)} payable` : `Next payable from ${fmtDate(m.dues.opensOn)}`, 'cash-stack', 'warning')}</div>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Quick actions</h2></div><div class="list-group list-group-flush">
        ${listItem('award', 'success', 'Accreditation certificate', m.certificate ? esc(m.certificate.serial) : 'Not issued', m.goodStanding && m.certificate ? `<button class="btn btn-sm btn-outline-secondary" ${on('click', 'viewFile', '/portal/certificate.pdf', EL, 'Accreditation certificate')}>View</button>` : '')}
        ${listItem('file-earmark-arrow-up', 'info', 'Renew MoF authorization', m.mofExpiry ? `Expires ${fmtDate(m.mofExpiry)}` : esc(m.mofRef), '<a class="btn btn-sm btn-outline-secondary" href="#/app/certificates">Upload</a>')}
        ${listItem('credit-card', 'warning', 'Pay annual dues', m.dues.payable ? `${K(m.dues.amount)} due` : `Paid until ${fmtDate(m.validUntil)}`, '<a class="btn btn-sm btn-outline-secondary" href="#/app/dues">Open</a>')}
        ${o.nextEvent ? listItem('calendar-event', 'primary', esc(o.nextEvent.name), `${fmtDate(o.nextEvent.date)} · ${esc(o.nextEvent.venue)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/events/${encodeURIComponent(o.nextEvent.id)}">View</a>`) : ''}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white d-flex"><h2 class="h6 mb-0 py-1">Announcements</h2><a class="ms-auto small" href="#/app/announcements">View all</a></div><div class="list-group list-group-flush">
        ${o.announcements.map(a => listItem('megaphone', 'primary', esc(a.title), fmtDate(a.publishedAt))).join('') || empty('No announcements.')}
      </div></div></div>
    </div>
    <div class="card"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1">Recent activity</h2></div><div class="list-group list-group-flush">
      ${o.activity.map(a => { const [ic, t] = ACTIVITY[a.kind] || ['dot', 'secondary']; return listItem(ic, t, esc(a.title), `${esc(a.detail)}${a.detail ? ' · ' : ''}${fmtDateTime(a.at)}`); }).join('') || empty('No activity yet.', 'activity')}
    </div></div>`;
}

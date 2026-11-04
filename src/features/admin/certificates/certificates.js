import { can } from '../../../core/auth/permissions.js';
import { EL, on } from '../../../core/events.js';
import { empty, esc, fmtDate, icon, listItem, lower, pageHeader, statCard, tableCard } from '../../../shared/ui/index.js';
import { accredBadge } from '../../common/index.js';
import { adm } from '../shared/api.js';

/* ================= CERTIFICATES ================= */
export async function certificates() {
  const apps = can('applications:read');
  const none = { items: [], total: 0 };
  const [review, approval, awaiting, renewals, certs] = await Promise.all([
    apps ? adm('/applications?stage=MOF_REVIEW&pageSize=100') : none, apps ? adm('/applications?stage=AWAITING_APPROVAL&pageSize=100') : none,
    apps ? adm('/applications?stage=PAYMENT_PENDING&pageSize=100') : none, adm('/renewals'), adm('/certificates'),
  ]);
  const soon = Date.now() + 90 * 864e5, valid = certs.filter(c => c.member.goodStanding);
  const mofList = [...review.items, ...approval.items];
  return pageHeader('Certificates', 'Verify Ministry of Finance authorizations, then issue MLAZ accreditation')
    + `<div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">${statCard('MoF to verify', Number(review.total) + renewals.length, `new & renewals · ${Number(approval.total)} awaiting approval`, 'file-earmark-check', 'warning')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Awaiting payment', Number(awaiting.total), 'certificate issues on payment', 'credit-card', 'success')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Accreditations valid', valid.length, 'members in good standing', 'patch-check', 'primary')}</div>
      <div class="col-sm-6 col-xl-3">${statCard('Expiring in 90 days', valid.filter(c => new Date(c.validUntil) <= soon).length, 'reminders sent automatically', 'calendar-x', 'danger')}</div>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">1</span>MoF authorizations to verify</h2></div><div class="list-group list-group-flush">
        ${mofList.map(a => listItem('file-earmark-text', 'warning', esc(a.businessName), `${esc(a.mofRef || '—')} · ${a.displayStage === 'AWAITING_APPROVAL' ? `recommended by ${esc(a.recommendedBy)}, awaiting approval` : 'new application'}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${esc(a.ref)}">Review</a>`)).join('')}
        ${renewals.map(r => listItem('file-earmark-text', 'info', esc(r.member.name), `${esc(r.mofRef)} · renewal uploaded ${fmtDate(r.submittedAt)}`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/members/${esc(r.member.number)}">Review</a>`)).join('')}
        ${mofList.length + renewals.length ? '' : empty('Nothing waiting for verification.', 'check2-circle')}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">2</span>Awaiting payment</h2></div><div class="list-group list-group-flush">
        <div class="list-group-item small text-body-secondary">${icon('lightning-charge', 'me-1 text-primary')}Certificates are issued automatically the moment payment is received.</div>
        ${awaiting.items.map(a => listItem('credit-card', 'success', esc(a.businessName), `MoF approved · ${esc(a.tier)} tier`, `<a class="btn btn-sm btn-outline-secondary" href="#/app/applications/${esc(a.ref)}">View</a>`)).join('') || empty('No applications awaiting payment.', 'check2-circle')}
      </div></div></div>
    </div>
    <h2 class="h6 mb-3">Issued accreditations</h2>`
    + tableCard(['Member', 'Certificate no.', 'Issued', 'Valid until', 'Status', '#'], certs.map(c => `<tr><td><a class="fw-medium" href="#/app/members/${esc(c.member.number)}">${esc(c.member.name)}</a><div class="small text-body-secondary">${esc(c.member.number)}</div></td>
      <td class="small font-monospace">${esc(c.serial)}</td><td class="small">${fmtDate(c.issuedAt)}</td><td class="small">${fmtDate(c.validUntil)}</td>
      <td>${c.member.goodStanding ? accredBadge('issued') : accredBadge(lower(c.member.accreditation))}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-secondary" title="Download certificate" ${on('click', 'getFile', `/admin/members/${encodeURIComponent(c.member.number)}/certificate.pdf`, EL)}>${icon('download')}</button></td></tr>`).join(''), 'No certificates issued yet.');
}

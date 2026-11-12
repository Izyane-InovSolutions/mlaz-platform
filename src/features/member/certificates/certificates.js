import { EL, expose, on } from '../../../core/events.js';
import { busy, done, esc, fail, fmtDate, icon, infoRow as row, lower, note, pageHeader, readForm } from '../../../shared/ui/index.js';
import { accredBadge, mofBadge } from '../../common/index.js';
import { portal } from '../shared/api.js';

/* ================= CERTIFICATES & MoF ================= */
export async function certificates() {
  const [m, renewals] = await Promise.all([portal('/profile'), portal('/mof-renewals')]);
  const pending = renewals.find(r => r.status === 'PENDING');
  const lastRejected = !pending && renewals[0]?.status === 'REJECTED' ? renewals[0] : null;
  return pageHeader('Certificates', 'Your Ministry of Finance authorization and MLAZ accreditation')
    + `<div class="row g-3 mb-3">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">1</span>Ministry of Finance authorization</h2></div><div class="card-body">
        ${row('Reference', esc(m.mofRef))}${row('Status', mofBadge(lower(m.mofStatus)))}${row('Expires', m.mofExpiry ? fmtDate(m.mofExpiry) : '—')}
        ${pending ? note('info', 'hourglass-split', `Renewal <b>${esc(pending.mofRef)}</b> uploaded ${fmtDate(pending.submittedAt)} and awaiting verification by the Secretariat.`, 'mt-3 mb-0')
        : `${lastRejected ? note('danger', 'x-octagon', `Your last renewal (${esc(lastRejected.mofRef)}) was not accepted: ${esc(lastRejected.reviewNote || '')}`, 'mt-3') : ''}
          <form class="mt-3" novalidate ${on('submit', 'uploadRenewal', EL)}><h3 class="h6 mt-2">Upload a renewed authorization</h3>
          <div class="row g-2"><div class="col-md-6"><input class="form-control" name="mofRef" aria-label="New MoF authorization reference" required maxlength="60" placeholder="New reference, e.g. MoF/ML/2027/0001"><div class="invalid-feedback">Required.</div></div>
          <div class="col-md-6"><input class="form-control" type="file" name="file" aria-label="Renewed MoF authorization document (PDF, JPG or PNG)" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach the document.</div></div>
          <div class="col-12"><button class="btn btn-primary">${icon('upload', 'me-1')} Submit for verification</button></div></div></form>`}
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white"><h2 class="h6 mb-0 py-1"><span class="badge text-bg-primary me-2">2</span>MLAZ accreditation</h2></div><div class="card-body d-flex flex-column">
        ${row('Certificate no.', m.certificate ? `<span class="font-monospace">${esc(m.certificate.serial)}</span>` : '—')}${row('Status', accredBadge(lower(m.accreditation)))}${row('Valid until', fmtDate(m.validUntil))}
        <p class="small text-body-secondary mt-3">Issued after your MoF authorization was verified and dues paid. Anyone can verify it by scanning the QR code.</p>
        <button class="btn btn-primary mt-auto" ${m.goodStanding && m.certificate ? '' : 'disabled'} ${on('click', 'viewFile', '/portal/certificate.pdf', EL, 'Accreditation certificate')}>${icon('eye', 'me-1')} View certificate</button>
      </div></div></div>
    </div>
    ${note('light border', 'info-circle', 'Your MoF authorization is verified <b>first</b>, then your MLAZ accreditation is issued. If your MoF authorization lapses, your accreditation is suspended until a renewal is verified.')}`;
}
async function uploadRenewal(form) {
  if (!readForm(form)) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Uploading…');
  try { await portal('/mof-renewals', { method: 'POST', form: new FormData(form) }); done('Authorization submitted for verification'); }
  catch (e) { busy(btn, false); fail(e); }
}

expose({ uploadRenewal });

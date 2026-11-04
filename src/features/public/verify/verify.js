import { pub } from '../../../core/api/client.js';
import { EL, expose, on } from '../../../core/events.js';
import { nav } from '../../../core/navigation.js';
import { esc, fmtDate, icon, lower, note as alertBox } from '../../../shared/ui/index.js';
import { accredBadge, mofBadge, tierBadge } from '../../common/index.js';

function verifyCard(m) {
  const ok = m.goodStanding;
  const row = (k, v) => `<div class="col-sm-6"><div class="small text-body-secondary">${k}</div><div class="fw-medium">${v}</div></div>`;
  return `<div class="card mb-3 ${ok ? 'border-success-subtle' : 'border-danger-subtle'}"><div class="card-body p-4">
    <div class="d-flex gap-3 align-items-center mb-4"><span class="icon-circle md ${ok ? 'bg-success-subtle text-success-emphasis' : 'bg-danger-subtle text-danger-emphasis'}">${icon(ok ? 'patch-check-fill' : 'exclamation-octagon')}</span>
      <div><h2 class="h5 mb-0">${ok ? 'Verified: accredited member in good standing' : 'Not an active accredited member'}</h2><div class="small text-body-secondary">${esc(m.name)} · checked ${fmtDate(new Date())}</div></div></div>
    <div class="row g-3">${row('Member', esc(m.name))}${row('Member number', esc(m.number))}${row('Location', `${esc(m.town)}, ${esc(m.province)}`)}${row('Tier', tierBadge(m.tier))}
      ${row('MoF authorization', mofBadge(lower(m.mofStatus)))}${row('MLAZ accreditation', accredBadge(lower(m.accreditation)))}${row('Valid until', fmtDate(m.validUntil))}${m.certificateSerial ? row('Certificate no.', `<span class="font-monospace">${esc(m.certificateSerial)}</span>`) : ''}</div>
    ${ok ? '' : alertBox('danger', 'exclamation-triangle', 'This lender is not currently an active accredited MLAZ member. Proceed with caution.', 'mt-4 mb-0')}
  </div></div>`;
}

export async function verify(q) {
  const query = (q || '').trim();
  let result = '';
  if (query.length > 0 && query.length < 3) result = alertBox('warning', 'info-circle', 'Enter at least 3 characters of the member number or business name.');
  else if (query) {
    const r = await pub(`/verify?q=${encodeURIComponent(query)}`);
    result = !r.results.length
      ? `<div class="card border-danger-subtle"><div class="card-body p-4 d-flex gap-3"><span class="icon-circle md bg-danger-subtle text-danger-emphasis">${icon('x-octagon')}</span>
          <div><h2 class="h5 mb-1">No MLAZ member found for “${esc(query)}”</h2><p class="small text-body-secondary mb-0">This lender does not appear in the MLAZ register. Proceed with caution and report suspicious lenders to the Secretariat.</p></div></div></div>`
      : (r.results.length > 1 ? `<p class="small text-body-secondary">${r.results.length} members match “${esc(query)}”.</p>` : '') + r.results.map(verifyCard).join('');
  }
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container mw-760">
    <h1 class="h2 fw-bold mb-1">Verify a lender</h1><p class="text-body-secondary">Enter a member number, certificate number or business name, or scan the QR code on a certificate.</p>
    <form class="d-flex gap-2 mb-4" ${on('submit', 'verifySearch', EL)}>
      <input class="form-control form-control-lg" name="q" aria-label="Member number or business name" placeholder="e.g. MLA-0421 or QuickLend" value="${esc(query)}" minlength="3" required>
      <button class="btn btn-primary btn-lg px-4">Verify</button>
    </form>${result}</div></section>`;
}

const verifySearch = form => nav(`verify/${encodeURIComponent(form.q.value.trim())}`);

expose({ verifySearch });

import { EL, expose, on } from '../../../core/events.js';
import { busy, done, esc, fail, pageHeader, readForm } from '../../../shared/ui/index.js';
import { accountCard } from '../../account/index.js';
import { portal } from '../shared/api.js';

/* ================= PROFILE ================= */
export async function profile() {
  const m = await portal('/profile');
  const ro = (label, value) => `<div class="col-md-6"><label class="form-label small fw-medium">${label}</label><input class="form-control" disabled value="${esc(value)}"></div>`;
  const f = (name, label, type, attrs) => `<div class="col-md-6"><label class="form-label small fw-medium">${label}</label><input class="form-control" name="${name}" type="${type}" ${attrs} value="${esc(m[name] || '')}"><div class="invalid-feedback">Check this field.</div></div>`;
  return pageHeader('Business profile', 'Keep your contact details current')
    + `<div class="row g-3"><div class="col-lg-7"><div class="card"><div class="card-body p-4">
      <h2 class="h6 fw-semibold">Registered details</h2><p class="small text-body-secondary">These appear on your certificate and in the public directory. To change them, contact the Secretariat.</p>
      <div class="row g-3 mb-4">${ro('Business name', m.name)}${ro('Member number', m.number)}${ro('Town', `${m.town}, ${m.province}`)}${ro('Tier', m.tier)}${ro('ZRA TPIN', m.tpin)}${ro('PACRA no.', m.pacra || '—')}</div>
      <h2 class="h6 fw-semibold">Contact details</h2>
      <form class="row g-3" novalidate ${on('submit', 'saveProfile', EL)}>
        ${f('contactName', 'Contact person', 'text', 'required maxlength="120"')}${f('contactPhone', 'Phone', 'tel', 'required maxlength="20"')}${f('contactEmail', 'Contact email', 'email', 'required maxlength="200"')}
        <div class="col-12"><label class="form-label small fw-medium">Physical address</label><input class="form-control" name="address" maxlength="300" value="${esc(m.address || '')}"></div>
        <div class="col-12"><button class="btn btn-primary">Save changes</button></div>
      </form>
    </div></div></div>
    <div class="col-lg-5">${accountCard()}</div></div>`;
}
async function saveProfile(form) {
  const v = readForm(form); if (!v) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Saving…');
  try { await portal('/profile', { method: 'PATCH', body: v }); done('Contact details saved'); } catch (e) { busy(btn, false); fail(e); }
}

expose({ saveProfile });

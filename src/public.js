import {
  esc, K, fmtDate, memberById, icon, avatar, tierBadge, mofBadge, accredBadge, stageBadge, stepper, readForm, toast,
  nav, after, expose, empty, modal, busy, rerender, NRC_ATTRS, digitsAttrs,
} from './ui.js';
import { ApiError, api, download, forgetTrackToken, pub, publicConfig, saveTrackToken, signIn, signOut, trackToken } from './api.js';
import { checkoutForm, readCheckout, runCheckout } from './checkout.js';

// Public website. Every page reads live data from the API (src/api.js); nothing here touches the local demo store.

const lower = s => String(s || '').toLowerCase();
const soft = (p, fallback = null) => p.catch(() => fallback); // optional sections degrade instead of breaking the page
const EVENT_TYPE = { TRAINING: 'Training', WEBINAR: 'Webinar', AGM: 'AGM', NETWORKING: 'Networking' };
const unavailable = what => `<p class="small text-body-secondary">${icon('cloud-slash', 'me-1')}${what} couldn’t be loaded right now.</p>`;
const alertBox = (tone, ic, html, cls = '') => `<div class="alert alert-${tone} small d-flex gap-2 ${cls}">${icon(ic)}<div>${html}</div></div>`;

/* ================= LAYOUT ================= */
export const brand = (sub = true) => `<a class="navbar-brand d-flex align-items-center gap-2 me-4" href="#/">
  <span class="brand-mark">${icon('shield-check')}</span>
  <span class="lh-sm"><span class="d-block fw-bold">MLAZ</span>${sub ? '<span class="d-none d-sm-block text-body-secondary brand-sub">Money Lenders Association of Zambia</span>' : ''}</span></a>`;

export function publicLayout(inner, active) {
  const link = (href, label, key) => `<li class="nav-item"><a class="nav-link ${active === key ? 'active fw-medium' : ''}" href="${href}">${label}</a></li>`;
  return `
  <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top py-2">
    <div class="container">
      ${brand()}
      <button class="navbar-toggler border-0" type="button" data-bs-toggle="collapse" data-bs-target="#pubnav" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
      <div class="collapse navbar-collapse" id="pubnav">
        <ul class="navbar-nav me-auto">
          <li class="nav-item"><a class="nav-link" href="javascript:void 0" onclick="goSection('about')">About</a></li>
          <li class="nav-item"><a class="nav-link" href="javascript:void 0" onclick="goSection('membership')">Membership</a></li>
          ${link('#/verify', 'Verify a lender', 'verify')}
          ${link('#/directory', 'Directory', 'directory')}
          ${link('#/track', 'Track application', 'track')}
        </ul>
        <div class="d-flex flex-column flex-lg-row gap-2 py-2 py-lg-0">
          <div class="dropdown">
            <button class="btn btn-outline-secondary dropdown-toggle w-100" data-bs-toggle="dropdown">${icon('box-arrow-in-right', 'me-1')} Sign in</button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
              <li><a class="dropdown-item py-2" href="#/login/member">${icon('building', 'me-2 text-primary')}Member portal</a></li>
              <li><a class="dropdown-item py-2" href="#/login/admin">${icon('person-badge', 'me-2 text-primary')}Secretariat</a></li>
            </ul>
          </div>
          <a class="btn btn-primary" href="#/apply">Apply for membership</a>
        </div>
      </div>
    </div>
  </nav>
  <main>${inner}</main>
  <footer class="site-footer pt-5 pb-4">
    <div class="container">
      <div class="row g-4">
        <div class="col-lg-4">
          <div class="d-flex align-items-center gap-2 mb-3"><span class="brand-mark">${icon('shield-check')}</span><span class="fw-bold text-white">Money Lenders Association of Zambia</span></div>
          <p class="small mb-0">The membership body for licensed money lenders in Zambia, promoting responsible, transparent lending and protecting borrowers.</p>
        </div>
        <div class="col-6 col-lg-2"><h6 class="text-white">Members</h6><ul class="list-unstyled small d-grid gap-2">
          <li><a href="#/apply">Apply for membership</a></li><li><a href="#/track">Track application</a></li><li><a href="#/login/member">Member portal</a></li></ul></div>
        <div class="col-6 col-lg-2"><h6 class="text-white">Borrowers</h6><ul class="list-unstyled small d-grid gap-2">
          <li><a href="#/verify">Verify a lender</a></li><li><a href="#/directory">Member directory</a></li><li><a href="#/login/admin">Secretariat sign in</a></li></ul></div>
        <div class="col-lg-4"><h6 class="text-white">Contact the Secretariat</h6><ul class="list-unstyled small d-grid gap-2">
          <li>${icon('geo-alt', 'me-2')}Lusaka, Zambia</li><li>${icon('envelope', 'me-2')}secretariat@mlaz.org.zm</li><li>${icon('clock', 'me-2')}Mon – Fri, 08:00 – 17:00</li></ul></div>
      </div>
      <hr class="border-secondary my-4">
      <div class="d-flex flex-wrap align-items-center gap-3 small">
        <span>© ${new Date().getFullYear()} Money Lenders Association of Zambia</span>
        <span class="ms-lg-auto d-flex align-items-center gap-2">Platform by <a href="https://izyane.com" target="_blank" class="text-decoration-underline"><span class="footer-logo"><img src="/izyane-white.png" alt="iZyane"></span></a></span>
      </div>
    </div>
  </footer>`;
}

/* ================= LANDING ================= */
const FEATURES = [
  ['award', 'Recognised accreditation', 'A QR-verifiable MLAZ certificate that shows borrowers and partners you operate to the association’s standards.'],
  ['search', 'Public directory listing', 'Members in good standing are listed in the public directory and pass instant verification checks.'],
  ['journal-check', 'Compliance support', 'BoZ and Ministry of Finance circulars, templates and the MLAZ code of conduct in one library.'],
  ['people', 'Industry network', 'AGMs, workshops and briefings on responsible lending, credit scoring and digital lending.'],
  ['phone', 'Pay dues online', 'Pay joining fees and annual dues with MTN, Airtel or Zamtel mobile money, card or bank transfer.'],
  ['megaphone', 'A collective voice', 'The Secretariat represents members’ interests in engagements with regulators and government.'],
];
const STEPS = [
  ['Apply online', 'Submit your business, PACRA and contact details in a few minutes.'],
  ['Upload your MoF authorization', 'Your Ministry of Finance money-lending authorization is required first.'],
  ['Secretariat verification', 'MLAZ verifies your authorization against the Ministry register.'],
  ['Pay and get accredited', 'Pay online and your accreditation certificate is issued automatically.'],
];
// Marketing copy per tier; prices and the tier list itself come from the API.
const TIER_INFO = {
  Bronze: { who: 'Small and start-up lenders', perks: ['Accreditation certificate', 'Public directory listing', 'Member portal & announcements'] },
  Silver: { who: 'Established lenders', perks: ['Everything in Bronze', 'Discounted workshops & training', 'Compliance resource library'] },
  Gold: { who: 'Large and multi-branch lenders', perks: ['Everything in Silver', 'Priority event registration', 'Featured directory listing'] },
};
const tiersByPrice = cfg => [...cfg.tiers].sort((a, b) => a.annualDues - b.annualDues);

async function home() {
  const cfg = await publicConfig();
  const [stats, news, events, recent] = await Promise.all([
    soft(pub('/stats')), soft(pub('/announcements')), soft(pub('/events')), soft(pub('/directory?sort=recent&pageSize=3')),
  ]);
  const tiers = tiersByPrice(cfg);
  return `
  <section class="hero py-5">
    <div class="container py-lg-5">
      <div class="row align-items-center g-5">
        <div class="col-lg-6">
          <span class="badge rounded-pill bg-primary-subtle text-primary-emphasis border border-primary-subtle mb-3 px-3 py-2">${icon('patch-check-fill', 'me-1')} ${new Date().getFullYear() + 1} membership renewals now open</span>
          <h1 class="display-5 fw-bold lh-sm mb-3">Trusted, accredited money lending in Zambia</h1>
          <p class="lead text-body-secondary mb-4">MLAZ brings licensed money lenders together under one code of conduct. Apply for membership, renew your accreditation and pay dues online, and let borrowers confirm you are in good standing.</p>
          <div class="d-flex flex-wrap gap-2">
            <a class="btn btn-primary btn-lg px-4" href="#/apply">Apply for membership ${icon('arrow-right', 'ms-1')}</a>
            <a class="btn btn-outline-secondary btn-lg px-4" href="#/login/member">Member sign in</a>
          </div>
          <div class="row g-4 mt-4 pt-2">
            <div class="col-4"><div class="h3 fw-bold mb-0">${stats?.accreditedMembers ?? '—'}</div><div class="small text-body-secondary">Accredited lenders</div></div>
            <div class="col-4"><div class="h3 fw-bold mb-0">${stats?.provinces ?? '—'}</div><div class="small text-body-secondary">Provinces covered</div></div>
            <div class="col-4"><div class="h3 fw-bold mb-0">${events ? events.length : '—'}</div><div class="small text-body-secondary">Upcoming events</div></div>
          </div>
        </div>
        <div class="col-lg-6">
          <div class="card border-0 shadow-lg">
            <div class="card-body p-4 p-md-5">
              <div class="d-flex align-items-center gap-3 mb-2"><span class="feature-icon">${icon('shield-check')}</span><div><h2 class="h5 mb-0">Verify a lender</h2><div class="small text-body-secondary">Check before you borrow</div></div></div>
              <p class="small text-body-secondary mt-3">Confirm that a money lender is an accredited MLAZ member authorized by the Ministry of Finance.</p>
              <form onsubmit="event.preventDefault();nav('verify/'+encodeURIComponent(this.q.value.trim()))">
                <div class="input-group input-group-lg">
                  <input name="q" class="form-control" placeholder="Member number or business name" minlength="3" required>
                  <button class="btn btn-primary" type="submit">Verify</button>
                </div>
              </form>
              <div class="small text-body-secondary mt-2">For example MLA-0421 or “Chingola Finance”</div>
              <hr class="my-4">
              <div class="small fw-semibold text-body-secondary text-uppercase mb-2">Recently accredited</div>
              ${recent ? `<div class="list-group list-group-flush">
                ${recent.items.map((m, i) => `<a href="#/verify/${encodeURIComponent(m.number)}" class="list-group-item list-group-item-action d-flex align-items-center gap-3 px-0">${avatar(m.name, i)}<div class="flex-grow-1"><div class="fw-medium">${esc(m.name)}</div><div class="small text-body-secondary">${esc(m.number)} · ${esc(m.town)}</div></div>${icon('patch-check-fill', 'text-success')}</a>`).join('')}
              </div>` : unavailable('Recent members')}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="py-5" id="about">
    <div class="container py-lg-4">
      <div class="text-center mx-auto mb-5" style="max-width:640px">
        <div class="text-primary fw-semibold small text-uppercase mb-2">Why join MLAZ</div>
        <h2 class="fw-bold">Credibility for your business, confidence for your borrowers</h2>
      </div>
      <div class="row g-4">
        ${FEATURES.map(([ic, title, text]) => `<div class="col-md-6 col-lg-4"><div class="card h-100 border-0 bg-body-tertiary"><div class="card-body p-4"><span class="feature-icon mb-3">${icon(ic)}</span><h3 class="h6 fw-semibold">${title}</h3><p class="small text-body-secondary mb-0">${text}</p></div></div></div>`).join('')}
      </div>
    </div>
  </section>

  <section class="py-5 bg-body-tertiary border-top border-bottom">
    <div class="container py-lg-4">
      <div class="text-center mx-auto mb-5" style="max-width:640px">
        <div class="text-primary fw-semibold small text-uppercase mb-2">How it works</div>
        <h2 class="fw-bold">From application to accreditation</h2>
        <p class="text-body-secondary">Your Ministry of Finance authorization is verified first. Only then is your MLAZ accreditation issued.</p>
      </div>
      <div class="row g-4">
        ${STEPS.map(([title, text], i) => `<div class="col-sm-6 col-lg-3"><span class="step-num mb-3">${i + 1}</span><h3 class="h6 fw-semibold">${title}</h3><p class="small text-body-secondary mb-0">${text}</p></div>`).join('')}
      </div>
    </div>
  </section>

  <section class="py-5" id="membership">
    <div class="container py-lg-4">
      <div class="text-center mx-auto mb-5" style="max-width:640px">
        <div class="text-primary fw-semibold small text-uppercase mb-2">Membership</div>
        <h2 class="fw-bold">Choose the tier that fits your business</h2>
        <p class="text-body-secondary">All tiers include a one-off joining fee of ${K(cfg.joiningFee)}. Annual dues renew each year from the date you are accredited.</p>
      </div>
      <div class="row g-4 justify-content-center">
        ${tiers.map((t, i) => {
          const info = TIER_INFO[t.name] || { who: t.description, perks: [] };
          const featured = i === Math.floor(tiers.length / 2);
          return `<div class="col-md-6 col-lg-4">
          <div class="card h-100 tier-card ${featured ? 'featured shadow' : ''}">
            <div class="card-body p-4 d-flex flex-column">
              <div class="d-flex justify-content-between align-items-center mb-2"><h3 class="h5 mb-0">${esc(t.name)}</h3>${featured ? '<span class="badge text-bg-primary">Most popular</span>' : ''}</div>
              <div class="small text-body-secondary mb-3">${esc(info.who)}</div>
              <div class="mb-3"><span class="display-6 fw-bold">${K(t.annualDues)}</span><span class="text-body-secondary"> / year</span></div>
              <ul class="list-unstyled small d-grid gap-2 mb-4">${info.perks.map(p => `<li>${icon('check2', 'text-primary me-2')}${p}</li>`).join('')}</ul>
              <a href="#/apply/${encodeURIComponent(t.name)}" class="btn ${featured ? 'btn-primary' : 'btn-outline-primary'} mt-auto">Apply for ${esc(t.name)}</a>
            </div>
          </div></div>`;
        }).join('')}
      </div>
    </div>
  </section>

  <section class="band-dark py-5">
    <div class="container py-lg-3">
      <div class="row align-items-center g-4">
        <div class="col-lg-8"><h2 class="fw-bold mb-2">Borrowing money? Check the lender first.</h2><p class="mb-0 opacity-75">Only accredited MLAZ members in good standing pass verification. If a lender is not listed, proceed with caution.</p></div>
        <div class="col-lg-4 d-flex gap-2 justify-content-lg-end flex-wrap"><a href="#/verify" class="btn btn-light btn-lg">Verify a lender</a><a href="#/directory" class="btn btn-outline-light btn-lg">Directory</a></div>
      </div>
    </div>
  </section>

  <section class="py-5">
    <div class="container py-lg-4">
      <div class="row g-5">
        <div class="col-lg-7">
          <h2 class="h4 fw-bold mb-4">Latest from the Secretariat</h2>
          ${news ? `<div class="d-grid gap-3">
            ${news.slice(0, 3).map(a => `<div class="card"><div class="card-body"><div class="d-flex gap-2 align-items-center small text-body-secondary mb-1"><span class="badge bg-secondary-subtle text-secondary-emphasis">${esc(a.tag)}</span>${fmtDate(a.publishedAt)}</div><h3 class="h6 fw-semibold mb-1">${esc(a.title)}</h3><p class="small text-body-secondary mb-0">${esc(a.body)}</p></div></div>`).join('') || empty('No announcements yet.', 'megaphone')}
          </div>` : unavailable('Announcements')}
        </div>
        <div class="col-lg-5">
          <h2 class="h4 fw-bold mb-4">Upcoming events</h2>
          ${events ? `<div class="list-group">
            ${events.slice(0, 4).map(e => { const d = new Date(e.date); return `<div class="list-group-item d-flex gap-3 py-3">
              <div class="text-center border rounded px-2 py-1" style="min-width:56px"><div class="small text-primary fw-semibold text-uppercase">${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}</div><div class="h5 mb-0 fw-bold">${d.getUTCDate()}</div></div>
              <div><div class="fw-medium">${esc(e.name)}</div><div class="small text-body-secondary">${esc(EVENT_TYPE[e.type] || e.type)} · ${esc(e.venue)} · ${e.price ? `${K(e.price)} per ticket` : 'Free'}</div></div></div>`; }).join('') || `<div class="list-group-item">${empty('No upcoming events.', 'calendar')}</div>`}
          </div>` : unavailable('Events')}
          <p class="small text-body-secondary mt-3">Members register for events from the <a href="#/login/member">member portal</a>.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="pb-5">
    <div class="container">
      <div class="card border-0 bg-primary-subtle"><div class="card-body p-4 p-lg-5 d-flex flex-wrap align-items-center gap-4">
        <div class="me-auto"><h2 class="h4 fw-bold mb-1">Ready to join MLAZ?</h2><p class="mb-0 text-body-secondary">Have your PACRA details and Ministry of Finance authorization ready. It takes about 10 minutes.</p></div>
        <a href="#/track" class="btn btn-outline-primary btn-lg">Track an application</a>
        <a href="#/apply" class="btn btn-primary btn-lg">Start your application</a>
      </div></div>
    </div>
  </section>`;
}

let pendingSection = null;
function goSection(id) {
  if (location.hash.replace(/^#\/?/, '') !== '') { pendingSection = id; nav(''); return; }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}
export function scrollPendingSection() {
  if (!pendingSection) return false;
  const id = pendingSection; pendingSection = null;
  setTimeout(() => document.getElementById(id)?.scrollIntoView(), 0);
  return true;
}

/* ================= APPLY ================= */
const W_STEPS = ['Business', 'Contact', 'Documents', 'Review'];
let W = null;
const tierDues = name => W.cfg.tiers.find(t => t.name === name)?.annualDues ?? 0;

async function apply(tier) {
  const cfg = await publicConfig();
  const names = cfg.tiers.map(t => t.name);
  W = { step: 0, cfg, data: { tier: names.includes(tier) ? tier : names.includes('Silver') ? 'Silver' : names[0] }, blobs: {} };
  after(renderWizard);
  return `<section class="py-5 bg-body-tertiary min-vh-75">
    <div class="container">
      <div class="mb-4"><a href="#/" class="small text-body-secondary">${icon('arrow-left', 'me-1')}Back to home</a><h1 class="h2 fw-bold mt-2 mb-1">Apply for membership</h1><p class="text-body-secondary mb-0">Join the Money Lenders Association of Zambia.</p></div>
      <div class="row g-4">
        <div class="col-lg-8"><div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5" id="wizard"></div></div></div>
        <div class="col-lg-4">
          <div class="card border-0 shadow-sm mb-4"><div class="card-body p-4">
            <h2 class="h6 fw-semibold mb-3">What you’ll need</h2>
            <ul class="list-unstyled small d-grid gap-2 mb-0">
              <li>${icon('file-earmark-text', 'text-primary me-2')}PACRA certificate of incorporation and ZRA TPIN</li>
              <li>${icon('person-vcard', 'text-primary me-2')}A director’s NRC (PDF or image)</li>
              <li>${icon('file-earmark-check', 'text-primary me-2')}Ministry of Finance money-lending authorization (PDF or image)</li>
              <li>${icon('person', 'text-primary me-2')}A contact person, phone number and email</li>
              <li>${icon('phone', 'text-primary me-2')}Mobile money, card or bank account to pay fees</li>
            </ul>
          </div></div>
          <div class="card border-0 shadow-sm"><div class="card-body p-4">
            <h2 class="h6 fw-semibold mb-3">Need help?</h2>
            <p class="small text-body-secondary mb-2">Contact the MLAZ Secretariat on <a href="mailto:secretariat@mlaz.org.zm">secretariat@mlaz.org.zm</a>.</p>
            <p class="small text-body-secondary mb-0">Already applied? <a href="#/track">Track your application</a>.</p>
          </div></div>
        </div>
      </div>
    </div>
  </section>`;
}
function renderWizard() {
  const box = document.getElementById('wizard'); if (!box) return;
  const d = W.data;
  const f = (name, label, opts = {}) => `<div class="${opts.col || 'col-md-6'}"><label class="form-label small fw-medium">${label}${opts.req === false ? ' <span class="text-body-secondary fw-normal">(optional)</span>' : ''}</label>
    <input class="form-control" name="${name}" type="${opts.type || 'text'}" ${opts.req === false ? '' : 'required'} ${opts.attrs || `${opts.pattern ? `pattern="${opts.pattern}"` : ''} placeholder="${opts.ph || ''}"`} value="${esc(d[name] || '')}">
    <div class="invalid-feedback">${opts.err || 'This field is required.'}</div></div>`;
  // A file already attached on an earlier visit to this step stays attached, so the input is only required when nothing is on file.
  const file = (name, label, req = true) => `<div class="col-12"><label class="form-label small fw-medium">${label} <span class="text-body-secondary fw-normal">(PDF, JPG or PNG, up to 10 MB${req ? '' : ', optional'})</span></label>
    <input class="form-control" type="file" name="${name}" accept=".pdf,.jpg,.jpeg,.png" ${req && !d[name] ? 'required' : ''}>${d[name] ? `<div class="form-text">${icon('paperclip')} ${esc(d[name])} attached</div>` : ''}<div class="invalid-feedback">Attach this document.</div></div>`;
  let body = '';
  if (W.step === 0) body = `<h2 class="h5 mb-1">Business details</h2><p class="small text-body-secondary mb-4">As registered with PACRA.</p>
    <div class="row g-3">
      ${f('name', 'Registered business name', { col: 'col-12' })}
      ${f('pacra', 'PACRA registration number', { attrs: digitsAttrs(12, 'e.g. 120240012345'), err: 'Enter your 12-digit PACRA number.' })}
      ${f('tpin', 'ZRA TPIN', { attrs: digitsAttrs(10, 'e.g. 1001845523'), err: 'Enter your 10-digit TPIN.' })}
      ${f('town', 'Town / city')}
      <div class="col-md-6"><label class="form-label small fw-medium">Province</label><select class="form-select" name="province" required><option value="">Select province</option>${W.cfg.provinces.map(p => `<option ${d.province === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select><div class="invalid-feedback">Select a province.</div></div>
      ${f('address', 'Physical address', { col: 'col-12' })}
      <div class="col-12"><label class="form-label small fw-medium">Membership tier</label><div class="row g-2">
        ${tiersByPrice(W.cfg).map(t => `<div class="col-md-4"><label class="tier-option border rounded p-3 d-flex gap-2 h-100"><input class="form-check-input" type="radio" name="tier" value="${esc(t.name)}" ${d.tier === t.name ? 'checked' : ''}><span><span class="fw-semibold d-block">${esc(t.name)}</span><span class="small text-body-secondary">${K(t.annualDues)} / year</span></span></label></div>`).join('')}
      </div></div>
    </div>`;
  if (W.step === 1) body = `<h2 class="h5 mb-1">Contact person</h2><p class="small text-body-secondary mb-4">We’ll send application updates and your tracking link to this person.</p>
    <div class="row g-3">${f('contact', 'Full name')}${f('position', 'Position', { ph: 'e.g. Managing Director' })}${f('phone', 'Phone number', { type: 'tel', ph: '097 000 0000' })}${f('email', 'Email address', { type: 'email', err: 'Enter a valid email address.' })}</div>`;
  if (W.step === 2) body = `<h2 class="h5 mb-1">Documents</h2><p class="small text-body-secondary mb-4">Company and director documents, and your Ministry of Finance authorization.</p>
    <h3 class="h6 fw-semibold">Company and director</h3>
    <div class="row g-3 mb-4">${file('pacraFile', 'PACRA certificate of incorporation')}
      ${f('director', 'Director full name')}${f('directorNrc', 'Director NRC number', { attrs: NRC_ATTRS, err: 'Enter all 9 digits, e.g. 284512/11/1.' })}
      ${file('nrcFile', 'Copy of director’s NRC')}</div>
    <h3 class="h6 fw-semibold">Ministry of Finance authorization</h3>
    ${alertBox('info', 'info-circle', 'Don’t have it to hand? Leave both fields blank and upload it later from <b>Track application</b>, using the link we email you.')}
    <div class="row g-3">${f('mofRef', 'Authorization reference', { req: false, ph: 'MoF/ML/2026/0000', col: 'col-12' })}${file('mofFile', 'Authorization document', false)}</div>`;
  if (W.step === 3) {
    const row = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
    body = `<h2 class="h5 mb-1">Review and submit</h2><p class="small text-body-secondary mb-4">Please confirm your details are correct.</p>
      <div class="row g-4">
        <div class="col-md-6"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Business</div>${row('Name', esc(d.name))}${row('PACRA no.', esc(d.pacra))}${row('TPIN', esc(d.tpin))}${row('Location', `${esc(d.town)}, ${esc(d.province)}`)}${row('Tier', esc(d.tier))}</div>
        <div class="col-md-6"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Contact</div>${row('Name', esc(d.contact))}${row('Phone', esc(d.phone))}${row('Email', esc(d.email))}${row('Director', `${esc(d.director)} · ${esc(d.directorNrc)}`)}</div>
        <div class="col-12"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Documents</div>${row('PACRA certificate', esc(d.pacraFile))}${row('Director NRC', esc(d.nrcFile))}${row('MoF authorization', d.mofRef ? esc(`${d.mofRef} · ${d.mofFile}`) : '<span class="text-warning-emphasis">To upload later</span>')}</div>
      </div>
      <div class="bg-body-tertiary rounded p-3 mt-4 small">
        <div class="d-flex justify-content-between"><span>Joining fee (one-off)</span><span>${K(W.cfg.joiningFee)}</span></div>
        <div class="d-flex justify-content-between"><span>${esc(d.tier)} annual dues</span><span>${K(tierDues(d.tier))}</span></div>
        <div class="d-flex justify-content-between fw-semibold border-top mt-2 pt-2"><span>Payable after MoF verification</span><span>${K(W.cfg.joiningFee + tierDues(d.tier))}</span></div>
      </div>
      <div class="form-check mt-4"><input class="form-check-input" type="checkbox" name="declare" id="declare" required><label class="form-check-label small" for="declare">I confirm the information provided is accurate and agree to abide by the MLAZ constitution and code of conduct.</label><div class="invalid-feedback">You must accept the declaration to submit.</div></div>`;
  }
  box.innerHTML = `<div class="mb-4">${stepper(W_STEPS, W.step)}</div><div id="wizerr"></div><form id="wform" novalidate>${body}</form>
    <div class="d-flex justify-content-between mt-4 pt-3 border-top">
      <button class="btn btn-light" ${W.step === 0 ? 'disabled' : ''} onclick="wizPrev()">${icon('arrow-left', 'me-1')} Back</button>
      ${W.step < 3 ? `<button class="btn btn-primary" onclick="wizNext()">Continue ${icon('arrow-right', 'ms-1')}</button>` : '<button class="btn btn-primary" onclick="wizSubmit(this)">Submit application</button>'}
    </div>`;
}
const wizError = html => { document.getElementById('wizerr').innerHTML = html ? alertBox('danger', 'exclamation-circle', html) : ''; };
function wizCapture() {
  const v = readForm(document.getElementById('wform'));
  if (!v) return false;
  ['mofFile', 'pacraFile', 'nrcFile'].forEach(k => {
    const file = document.querySelector(`#wform [name=${k}]`)?.files[0];
    if (file) W.blobs[k] = file;
    if (!v[k]) delete v[k];
  });
  Object.assign(W.data, v); return true;
}
function wizNext() {
  if (!wizCapture()) return;
  // The server needs the MoF reference and document together (or neither, to upload later).
  if (W.step === 2 && !!W.data.mofRef !== !!W.blobs.mofFile) {
    return wizError(W.data.mofRef ? 'Attach the MoF authorization document for the reference you entered, or clear the reference to upload both later.' : 'Enter the authorization reference for the MoF document you attached, or remove the document to upload both later.');
  }
  W.step++; renderWizard(); window.scrollTo({ top: 0, behavior: 'smooth' });
}
function wizPrev() { const form = document.getElementById('wform'); const v = {}; form.querySelectorAll('[name]').forEach(el => { if (el.type === 'radio') { if (el.checked) v[el.name] = el.value; } else if (el.type !== 'file' && el.type !== 'checkbox') v[el.name] = el.value.trim(); }); Object.assign(W.data, v); W.step--; renderWizard(); }

async function wizSubmit(btn) {
  if (!wizCapture()) return;
  const d = W.data, fd = new FormData();
  ['name', 'pacra', 'tpin', 'town', 'province', 'address', 'tier', 'contact', 'position', 'phone', 'email', 'director', 'directorNrc', 'mofRef'].forEach(k => fd.append(k, d[k] || ''));
  fd.append('declare', 'true');
  ['pacraFile', 'nrcFile', 'mofFile'].forEach(k => { if (W.blobs[k]) fd.append(k, W.blobs[k], W.blobs[k].name); });
  wizError('');
  busy(btn, true, 'Submitting…');
  let r;
  try {
    r = await pub('/applications', { method: 'POST', form: fd });
  } catch (e) {
    busy(btn, false);
    const fields = e instanceof ApiError ? e.fields : [];
    return wizError(fields.length ? `Please correct the following and resubmit:<ul class="mb-0 mt-1">${fields.map(f => `<li>${esc(f.message)}${f.field ? ` <span class="text-body-secondary">(${esc(f.field)})</span>` : ''}</li>`).join('')}</ul>` : esc(e.message));
  }
  saveTrackToken(r.ref, r.trackingToken);
  const hasMof = r.stage === 'MOF_REVIEW';
  document.getElementById('wizard').innerHTML = `<div class="text-center py-4">
    <span class="icon-circle bg-success-subtle text-success-emphasis mb-3" style="width:72px;height:72px;font-size:2rem">${icon('check-lg')}</span>
    <h2 class="h4">Application submitted</h2>
    <p class="text-body-secondary">Thank you, ${esc(d.contact)}. We’ve emailed a confirmation and your private tracking link to ${esc(d.email)}.</p>
    <div class="d-inline-block bg-body-tertiary rounded px-4 py-3 my-2"><div class="small text-body-secondary">Your application reference</div><div class="h3 fw-bold mb-0 font-monospace">${esc(r.ref)}</div></div>
    <div class="text-start mx-auto mt-4" style="max-width:440px"><div class="small fw-semibold mb-2">What happens next</div>
      <ol class="small text-body-secondary d-grid gap-1 ps-3 mb-0">
        ${hasMof ? '' : '<li>Upload your Ministry of Finance authorization from Track application.</li>'}
        <li>The Secretariat verifies your MoF authorization (1–2 working days).</li>
        <li>You pay the joining fee and first year’s dues online.</li>
        <li>Your accreditation certificate is issued automatically and your member portal is activated.</li>
      </ol></div>
    <div class="d-flex justify-content-center gap-2 mt-4"><a href="#/" class="btn btn-light">Back to home</a><a href="#/track/${encodeURIComponent(r.ref)}" class="btn btn-primary">Track application</a></div>
  </div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================= TRACK APPLICATION ================= */
// Applicants have no account: their application opens with the token from the emailed link (?t=…), which this
// browser also remembers from the moment they applied.
const TRACK_STEPS = ['Submitted', 'MoF authorization', 'Verification', 'Payment', 'Accredited'];
const TRACK_IDX = { DETAILS: 1, MOF_REVIEW: 2, PAYMENT_PENDING: 3, ACCREDITED: 5 };
const tokenHeader = ref => ({ 'x-tracking-token': trackToken(ref) || '' });
let trackTimer = null;

async function track(refParam, query) {
  clearTimeout(trackTimer);
  const ref = (refParam || '').trim().toUpperCase();
  const linkToken = query?.get('t');
  if (ref && linkToken) {
    // Keep the token out of the address bar (and screenshots, shared links) once it's remembered.
    saveTrackToken(ref, linkToken);
    history.replaceState(null, '', `#/track/${encodeURIComponent(ref)}`);
  }
  let result = '';
  if (ref && !trackToken(ref)) result = needLink(ref, false);
  else if (ref) {
    try {
      const [a, cfg] = await Promise.all([pub(`/applications/${encodeURIComponent(ref)}`, { headers: tokenHeader(ref) }), publicConfig()]);
      result = trackCard(a, cfg);
    } catch (e) {
      if (e.status !== 404) throw e;
      forgetTrackToken(ref);
      result = needLink(ref, true);
    }
  }
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container" style="max-width:860px">
    <h1 class="h2 fw-bold mb-1">Track your application</h1><p class="text-body-secondary">Open the link in your confirmation email, or enter your reference, e.g. APP-2042.</p>
    <form class="d-flex gap-2 mb-4" onsubmit="event.preventDefault();nav('track/'+encodeURIComponent(this.ref.value.trim().toUpperCase()))">
      <input class="form-control form-control-lg" name="ref" placeholder="Application reference" value="${esc(ref)}" required>
      <button class="btn btn-primary btn-lg px-4">Track</button>
    </form>${result}</div></section>`;
}

const needLink = (ref, invalid) => `<div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5">
  <div class="d-flex gap-3 mb-3"><span class="icon-circle bg-warning-subtle text-warning-emphasis" style="width:48px;height:48px;font-size:1.4rem">${icon(invalid ? 'exclamation-triangle' : 'envelope-paper')}</span>
  <div><h2 class="h5 mb-1">${invalid ? `We couldn’t open application ${esc(ref)}` : `Open your tracking link for ${esc(ref)}`}</h2>
  <p class="small text-body-secondary mb-0">${invalid ? 'The reference or link isn’t valid. Check the reference in your confirmation email.' : 'To keep applications private, they can only be opened from the link we emailed when you applied, or in the browser you applied from.'}
  Enter the email address on the application and we’ll send the link again.</p></div></div>
  <form class="row g-2" novalidate onsubmit="event.preventDefault();trackResend('${esc(ref)}',this)">
    <div class="col-sm"><input class="form-control" type="email" name="email" placeholder="Contact email on the application" required><div class="invalid-feedback">Enter a valid email address.</div></div>
    <div class="col-sm-auto"><button class="btn btn-primary w-100">Email me the link</button></div>
  </form></div></div>`;

function trackCard(a, cfg) {
  const ref = esc(a.ref);
  const fees = `<div class="bg-body-tertiary rounded p-3 small">
    <div class="d-flex justify-content-between"><span>Joining fee</span><span>${K(a.fees.joiningFee)}</span></div>
    <div class="d-flex justify-content-between"><span>${esc(a.tier)} annual dues</span><span>${K(a.fees.annualDues)}</span></div>
    <div class="d-flex justify-content-between fw-semibold border-top mt-2 pt-2"><span>Total due</span><span>${K(a.fees.total)}</span></div></div>`;
  const payBlock = `<div class="row g-4"><div class="col-md-6">${fees}</div>
    <div class="col-md-6">${checkoutForm('tpay', { methods: cfg.paymentMethods })}
      <button class="btn btn-primary w-100 mt-3" onclick="trackPay('${ref}',this)">Pay ${K(a.fees.total)}</button>
      <div class="small text-body-secondary text-center mt-2">${icon('lock', 'me-1')}Secured payment · receipt emailed automatically</div></div></div>`;

  let action = '';
  if (a.stage === 'DETAILS') action = `${a.returnNote ? alertBox('danger', 'arrow-return-left', `<b>Returned by the Secretariat:</b> ${esc(a.returnNote)}`) : ''}
    <h3 class="h6 fw-semibold">Upload your Ministry of Finance authorization</h3>
    <form id="mofform" class="row g-3" novalidate onsubmit="event.preventDefault();trackUpload('${ref}',this)">
      <div class="col-12"><label class="form-label small fw-medium">Authorization reference</label><input class="form-control" name="mofRef" required placeholder="MoF/ML/2026/0000"><div class="invalid-feedback">Required.</div></div>
      <div class="col-12"><label class="form-label small fw-medium">Document <span class="text-body-secondary fw-normal">(PDF, JPG or PNG, up to 10 MB)</span></label><input class="form-control" type="file" name="mofFile" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach the authorization document.</div></div>
      <div class="col-12"><button class="btn btn-primary">Submit for verification</button></div>
    </form>`;

  if (a.stage === 'MOF_REVIEW') action = alertBox('info', 'hourglass-split', `Your authorization <b>${esc(a.mofRef)}</b> is being verified by the Secretariat. This usually takes 1–2 working days. We’ll email you when it’s done.`, 'mb-0 fs-6');

  if (a.stage === 'PAYMENT_PENDING') {
    const p = a.payment?.status === 'PENDING' ? a.payment : null;
    if (p?.method === 'BANK_TRANSFER' && p.awaitingProof) {
      const b = p.bankAccount || {};
      const row = (k, v) => `<div class="d-flex justify-content-between gap-2"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
      action = `${alertBox('success', 'check-circle', 'Your MoF authorization has been verified. Complete your bank transfer, then upload the proof of payment.')}
        <div class="row g-4"><div class="col-md-6"><div class="bg-body-tertiary rounded p-3 small d-grid gap-1"><div class="fw-semibold mb-1">Pay ${K(p.amount)} into this account</div>
          ${row('Bank', esc(b.bank))}${row('Account name', esc(b.name))}${row('Account number', `<span class="font-monospace">${esc(b.number)}</span>`)}${row('Branch', esc(b.branch))}${row('Payment reference', `<span class="font-monospace">${esc(p.ref)}</span>`)}</div></div>
        <div class="col-md-6"><form id="proofform" class="d-grid gap-2" novalidate onsubmit="event.preventDefault();trackProof('${ref}','${esc(p.ref)}',this)">
          <div><label class="form-label small fw-medium">Your bank transaction reference</label><input class="form-control" name="bankRef" required placeholder="e.g. FT26285ABC12"><div class="invalid-feedback">Required.</div></div>
          <div><label class="form-label small fw-medium">Proof of payment <span class="text-body-secondary fw-normal">(PDF, JPG or PNG)</span></label><input class="form-control" type="file" name="proof" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach your deposit slip or transfer confirmation.</div></div>
          <button class="btn btn-primary">Submit proof of payment</button></form></div></div>
        <details class="mt-4"><summary class="small">Pay another way instead</summary><div class="mt-3">${payBlock}</div></details>`;
    } else if (p?.method === 'BANK_TRANSFER') {
      action = alertBox('info', 'hourglass-split', `We’ve received your proof of payment for <b>${K(p.amount)}</b> (bank ref ${esc(p.bankRef)}). MLAZ Finance will confirm the transfer, usually within 1 working day, and your accreditation certificate is issued automatically once it’s confirmed.`, 'mb-0 fs-6');
    } else if (p) {
      action = alertBox('info', 'hourglass-split', `<div class="d-flex align-items-center gap-2"><span class="spinner-border spinner-border-sm"></span><b>Waiting for confirmation of payment ${esc(p.ref)}</b> (${K(p.amount)} by ${esc(p.methodLabel)})</div>
        <div class="mt-1">This page updates automatically.${p.checkoutUrl ? ` <a href="${esc(p.checkoutUrl)}" target="_blank" rel="noopener">Open secure checkout</a>.` : ''}</div>`, 'mb-0 fs-6');
      after(() => { trackTimer = setTimeout(() => { if (location.hash === `#/track/${encodeURIComponent(a.ref)}`) rerender(); }, 4000); });
    } else {
      action = `${alertBox('success', 'check-circle', 'Your MoF authorization has been verified. Complete payment to receive your accreditation.')}${payBlock}`;
    }
  }

  if (a.stage === 'ACCREDITED') action = `${alertBox('success', 'award', `Congratulations, you are now an accredited MLAZ member. Your member number is <b>${esc(a.member?.number)}</b>.`)}
    <p class="small">We’ve emailed <b>${esc(a.contactEmail)}</b> a link to set your member portal password. Use it within 7 days.</p>
    <div class="d-flex flex-wrap gap-2">
      <button class="btn btn-outline-primary" onclick="trackCert('${ref}',this)">${icon('award', 'me-1')} Download certificate</button>
      ${a.payment?.status === 'SUCCESS' ? `<button class="btn btn-outline-secondary" onclick="trackReceipt('${ref}','${esc(a.payment.ref)}',this)">${icon('receipt', 'me-1')} Receipt</button>` : ''}
      <a class="btn btn-primary" href="#/login/member">Go to member portal</a></div>`;

  if (a.stage === 'REJECTED') action = alertBox('danger', 'x-octagon', `<b>This application was not approved.</b> ${esc(a.rejectionReason || '')}<div class="mt-1">Contact the Secretariat on secretariat@mlaz.org.zm if you have questions.</div>`, 'mb-0 fs-6');

  return `<div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-4"><div><div class="small text-body-secondary font-monospace">${ref}</div><h2 class="h4 mb-0">${esc(a.businessName)}</h2><div class="small text-body-secondary">${esc(a.town)} · ${esc(a.tier)} tier · submitted ${fmtDate(a.submittedAt)}</div></div>${stageBadge(lower(a.stage))}</div>
    ${TRACK_IDX[a.stage] ? `<div class="mb-4">${stepper(TRACK_STEPS, TRACK_IDX[a.stage])}</div>` : ''}${action}</div></div>`;
}

async function trackUpload(ref, form) {
  if (!readForm(form)) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Uploading…');
  try {
    await pub(`/applications/${ref}/mof`, { method: 'POST', form: new FormData(form), headers: tokenHeader(ref) });
    toast('Authorization submitted for verification');
    rerender();
  } catch (e) { busy(btn, false); toast(e.message, 'error'); }
}

async function trackPay(ref, btn) {
  const checkout = readCheckout('tpay'); if (!checkout) return;
  busy(btn, true, 'Starting payment…');
  try {
    await runCheckout({
      start: () => pub(`/applications/${ref}/payments`, { method: 'POST', body: checkout, headers: tokenHeader(ref) }),
      poll: payRef => pub(`/applications/${ref}/payments/${payRef}`, { headers: tokenHeader(ref) }),
      receipt: payRef => trackReceipt(ref, payRef),
      onDone: () => rerender(),
    });
  } catch (e) {
    toast(e.message, 'error');
    if (e.status === 409) rerender(); // a payment is already in flight: show its status
  } finally { busy(btn, false); }
}

async function trackProof(ref, payRef, form) {
  if (!readForm(form)) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Uploading…');
  try {
    await pub(`/applications/${ref}/payments/${payRef}/proof`, { method: 'POST', form: new FormData(form), headers: tokenHeader(ref) });
    toast('Proof of payment submitted');
    rerender();
  } catch (e) { busy(btn, false); toast(e.message, 'error'); }
}

async function trackFile(path, ref, btn) {
  busy(btn, true, 'Preparing…');
  try { await download(path, { auth: false, headers: tokenHeader(ref) }); } catch (e) { toast(e.message, 'error'); } finally { busy(btn, false); }
}
const trackCert = (ref, btn) => trackFile(`/public/applications/${ref}/certificate.pdf`, ref, btn);
const trackReceipt = (ref, payRef, btn) => trackFile(`/public/applications/${ref}/payments/${payRef}/receipt.pdf`, ref, btn);

async function trackResend(ref, form) {
  const v = readForm(form); if (!v) return;
  const btn = form.querySelector('button');
  busy(btn, true, 'Sending…');
  try {
    await pub(`/applications/${ref}/resend-link`, { method: 'POST', body: { email: v.email } });
    form.outerHTML = alertBox('success', 'envelope-check', `If <b>${esc(v.email)}</b> is the contact email on ${esc(ref)}, the tracking link is on its way. Check your inbox (and spam folder).`, 'mb-0');
  } catch (e) { busy(btn, false); toast(e.message, 'error'); }
}

/* ================= SIGN IN ================= */
const DEMO = { member: 'info@quicklend.zm', admin: 'secretariat@mlaz.org.zm' };
const DEMO_STAFF = [['secretariat@mlaz.org.zm', 'Secretariat Admin (approver)'], ['officer@mlaz.org.zm', 'Membership Officer'], ['finance@mlaz.org.zm', 'Finance Officer'], ['comms@mlaz.org.zm', 'Communications Officer']];

function login(role) {
  role = role === 'admin' ? 'admin' : 'member';
  const member = role === 'member', dev = import.meta.env.DEV;
  return `<section class="py-5 bg-body-tertiary min-vh-75 d-flex align-items-center"><div class="container"><div class="row justify-content-center"><div class="col-md-8 col-lg-5">
    <div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5">
      <div class="text-center mb-4"><span class="brand-mark lg">${icon(member ? 'building' : 'person-badge')}</span><h1 class="h4 mt-3 mb-1">${member ? 'Member portal' : 'Secretariat sign in'}</h1><p class="small text-body-secondary mb-0">${member ? 'Manage your membership, dues and certificates.' : 'MLAZ staff access to the administration console.'}</p></div>
      <ul class="nav nav-pills nav-fill bg-body-tertiary rounded p-1 mb-4 small">
        <li class="nav-item"><a class="nav-link ${member ? 'active' : ''}" href="#/login/member">Member</a></li>
        <li class="nav-item"><a class="nav-link ${member ? '' : 'active'}" href="#/login/admin">Secretariat</a></li>
      </ul>
      <div id="loginerr"></div>
      <form onsubmit="event.preventDefault();doLogin('${role}',this)" novalidate>
        <div class="mb-3"><label class="form-label small fw-medium">Email address</label><input class="form-control form-control-lg" type="email" name="email" value="${dev ? DEMO[role] : ''}" autocomplete="username" required></div>
        <div class="mb-3"><label class="form-label small fw-medium">Password</label><input class="form-control form-control-lg" type="password" name="password" autocomplete="current-password" required></div>
        <div class="d-flex justify-content-between align-items-center mb-4 small">
          <div class="form-check"><input class="form-check-input" type="checkbox" name="remember" id="remember"><label class="form-check-label" for="remember">Keep me signed in</label></div>
          <a href="javascript:void 0" onclick="forgotPassword(this.closest('form').email.value)">Forgot password?</a>
        </div>
        <button class="btn btn-primary btn-lg w-100">Sign in</button>
      </form>
      ${member ? '<p class="text-center small mt-4 mb-0 text-body-secondary">Not a member yet? <a href="#/apply">Apply for membership</a></p>' : ''}
      ${dev ? `<div class="small text-body-secondary mt-4 border-top pt-3"><div class="fw-medium mb-1">${icon('tools', 'me-1')}Demo accounts (development only)</div>
        ${member ? `<div>${DEMO.member} · or any seeded member email</div>` : DEMO_STAFF.map(([e, t]) => `<div>${e} · ${t}</div>`).join('')}
        <div class="mt-1">Password: the seed password (<span class="font-monospace">Mlaz@2026demo</span> by default)</div></div>` : ''}
    </div></div>
  </div></div></div></section>`;
}

async function doLogin(role, form) {
  const email = form.email.value.trim().toLowerCase(), pwd = form.password.value, btn = form.querySelector('button.btn-primary');
  const err = msg => { document.getElementById('loginerr').innerHTML = alertBox('danger', 'exclamation-circle', msg); };
  if (!email || !pwd) return err('Enter your email address and password.');
  busy(btn, true, 'Signing in…');
  try {
    const s = await signIn(email, pwd, role === 'admin' ? 'staff' : 'member', form.remember.checked);
    // Transitional: the portal pages still read the demo data, so a member that only exists on the server can't open them yet.
    if (role === 'member' && !memberById(s.memberId)) {
      await signOut();
      busy(btn, false);
      return err(`Your account for <b>${esc(s.memberName || s.memberId)}</b> is active, but the member portal isn’t connected to the live system yet. Please check back soon.`);
    }
    nav(role === 'admin' ? 'app/dashboard' : 'app/overview');
  } catch (e) {
    busy(btn, false);
    const other = role === 'admin' ? '<a href="#/login/member">Use the member sign-in instead</a>.' : '<a href="#/login/admin">Use the Secretariat sign-in instead</a>.';
    err(`${esc(e.message)}${e.code === 'WRONG_PORTAL' ? ` ${other}` : ''}`);
  }
}

function forgotPassword(prefill = '') {
  const el = modal({
    title: 'Reset your password',
    body: `<p class="small text-body-secondary">Enter the email you sign in with. If it has an account, we’ll email a link to set a new password (valid for 1 hour).</p>
      <form novalidate onsubmit="event.preventDefault()"><input class="form-control" type="email" name="email" value="${esc(prefill)}" required placeholder="you@example.zm"><div class="invalid-feedback">Enter a valid email address.</div></form>`,
    footer: '<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" data-ok>Send reset link</button>',
  });
  const send = async () => {
    const v = readForm(el.querySelector('form')); if (!v) return;
    const btn = el.querySelector('[data-ok]');
    busy(btn, true, 'Sending…');
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email: v.email }, auth: false });
      el.close(); toast('If that email has an account, a reset link is on its way');
    } catch (e) { busy(btn, false); toast(e.message, 'error'); }
  };
  el.querySelector('[data-ok]').onclick = send;
  el.querySelector('form').onsubmit = e => { e.preventDefault(); send(); };
}

/* ================= SET PASSWORD (invite and reset links) ================= */
function setPassword(_, query) {
  const token = query?.get('token');
  const card = inner => `<section class="py-5 bg-body-tertiary min-vh-75 d-flex align-items-center"><div class="container"><div class="row justify-content-center"><div class="col-md-8 col-lg-5">
    <div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5" id="setpw">${inner}</div></div></div></div></div></section>`;
  if (!token) return card(`<h1 class="h4 mb-2">Set your password</h1><p class="small text-body-secondary mb-0">Open the link from your invitation or password-reset email. Links expire; <a href="javascript:void 0" onclick="forgotPassword()">ask for a new one</a>.</p>`);
  return card(`<div class="text-center mb-4"><span class="brand-mark lg">${icon('key')}</span><h1 class="h4 mt-3 mb-1">Set your password</h1><p class="small text-body-secondary mb-0">Choose a password for your MLAZ account. Use at least 10 characters.</p></div>
    <div id="setpwerr"></div>
    <form novalidate onsubmit="event.preventDefault();submitNewPassword('${esc(token)}',this)">
      <div class="mb-3"><label class="form-label small fw-medium">New password</label><input class="form-control form-control-lg" type="password" name="password" minlength="10" autocomplete="new-password" required><div class="invalid-feedback">Use at least 10 characters.</div></div>
      <div class="mb-4"><label class="form-label small fw-medium">Confirm password</label><input class="form-control form-control-lg" type="password" name="confirm" minlength="10" autocomplete="new-password" required><div class="invalid-feedback">Repeat the password.</div></div>
      <button class="btn btn-primary btn-lg w-100">Set password</button>
    </form>`);
}

async function submitNewPassword(token, form) {
  const v = readForm(form); if (!v) return;
  const errBox = document.getElementById('setpwerr');
  if (v.password !== v.confirm) { form.confirm.classList.add('is-invalid'); errBox.innerHTML = alertBox('danger', 'exclamation-circle', 'The passwords don’t match.'); return; }
  const btn = form.querySelector('button');
  busy(btn, true, 'Saving…');
  try {
    const r = await api('/auth/password/set', { method: 'POST', body: { token, password: v.password }, auth: false });
    history.replaceState(null, '', '#/set-password'); // the link is single-use; drop it from the address bar
    document.getElementById('setpw').innerHTML = `<div class="text-center py-2">
      <span class="icon-circle bg-success-subtle text-success-emphasis mb-3" style="width:64px;height:64px;font-size:1.8rem">${icon('check-lg')}</span>
      <h1 class="h4">Password set</h1><p class="small text-body-secondary">You can now sign in as <b>${esc(r.email)}</b>.</p>
      <div class="d-flex justify-content-center gap-2"><a class="btn btn-primary" href="#/login/member">Member sign in</a><a class="btn btn-outline-secondary" href="#/login/admin">Secretariat sign in</a></div></div>`;
  } catch (e) {
    busy(btn, false);
    errBox.innerHTML = alertBox('danger', 'exclamation-circle', `${esc(e.message)}${e.code === 'BAD_REQUEST' ? ' <a href="javascript:void 0" onclick="forgotPassword()">Send me a new link</a>.' : ''}`);
  }
}

/* ================= VERIFY & DIRECTORY ================= */
function verifyCard(m) {
  const ok = m.goodStanding;
  const row = (k, v) => `<div class="col-sm-6"><div class="small text-body-secondary">${k}</div><div class="fw-medium">${v}</div></div>`;
  return `<div class="card mb-3 ${ok ? 'border-success-subtle' : 'border-danger-subtle'}"><div class="card-body p-4">
    <div class="d-flex gap-3 align-items-center mb-4"><span class="icon-circle ${ok ? 'bg-success-subtle text-success-emphasis' : 'bg-danger-subtle text-danger-emphasis'}" style="width:48px;height:48px;font-size:1.4rem">${icon(ok ? 'patch-check-fill' : 'exclamation-octagon')}</span>
      <div><h2 class="h5 mb-0">${ok ? 'Verified: accredited member in good standing' : 'Not an active accredited member'}</h2><div class="small text-body-secondary">${esc(m.name)} · checked ${fmtDate(new Date())}</div></div></div>
    <div class="row g-3">${row('Member', esc(m.name))}${row('Member number', esc(m.number))}${row('Location', `${esc(m.town)}, ${esc(m.province)}`)}${row('Tier', tierBadge(esc(m.tier)))}
      ${row('MoF authorization', mofBadge(lower(m.mofStatus)))}${row('MLAZ accreditation', accredBadge(lower(m.accreditation)))}${row('Valid until', fmtDate(m.validUntil))}${m.certificateSerial ? row('Certificate no.', `<span class="font-monospace">${esc(m.certificateSerial)}</span>`) : ''}</div>
    ${ok ? '' : alertBox('danger', 'exclamation-triangle', 'This lender is not currently an active accredited MLAZ member. Proceed with caution.', 'mt-4 mb-0')}
  </div></div>`;
}

async function verify(q) {
  const query = (q || '').trim();
  let result = '';
  if (query.length > 0 && query.length < 3) result = alertBox('warning', 'info-circle', 'Enter at least 3 characters of the member number or business name.');
  else if (query) {
    const r = await pub(`/verify?q=${encodeURIComponent(query)}`);
    result = !r.results.length
      ? `<div class="card border-danger-subtle"><div class="card-body p-4 d-flex gap-3"><span class="icon-circle bg-danger-subtle text-danger-emphasis" style="width:48px;height:48px;font-size:1.4rem">${icon('x-octagon')}</span>
          <div><h2 class="h5 mb-1">No MLAZ member found for “${esc(query)}”</h2><p class="small text-body-secondary mb-0">This lender does not appear in the MLAZ register. Proceed with caution and report suspicious lenders to the Secretariat.</p></div></div></div>`
      : (r.results.length > 1 ? `<p class="small text-body-secondary">${r.results.length} members match “${esc(query)}”.</p>` : '') + r.results.map(verifyCard).join('');
  }
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container" style="max-width:760px">
    <h1 class="h2 fw-bold mb-1">Verify a lender</h1><p class="text-body-secondary">Enter a member number, certificate number or business name, or scan the QR code on a certificate.</p>
    <form class="d-flex gap-2 mb-4" onsubmit="event.preventDefault();nav('verify/'+encodeURIComponent(this.q.value.trim()))">
      <input class="form-control form-control-lg" name="q" placeholder="e.g. MLA-0421 or QuickLend" value="${esc(query)}" minlength="3" required>
      <button class="btn btn-primary btn-lg px-4">Verify</button>
    </form>${result}</div></section>`;
}

const DIR_PAGE = 24;
let dir = { page: 1, items: [], total: 0 }, dirTimer = null, dirSeq = 0;

async function directory() {
  const cfg = await publicConfig();
  dir = { page: 1, items: [], total: 0 };
  after(() => loadDirectory());
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container">
    <h1 class="h2 fw-bold mb-1">Member directory</h1><p class="text-body-secondary">Accredited money lenders in good standing with MLAZ.</p>
    <div class="row g-2 mb-4">
      <div class="col-md-6"><div class="input-group"><span class="input-group-text bg-white">${icon('search')}</span><input class="form-control" id="dirq" placeholder="Search by name, town or member number" oninput="filterDirectory()"></div></div>
      <div class="col-6 col-md-3"><select class="form-select" id="dirprov" onchange="filterDirectory()"><option value="">All provinces</option>${cfg.provinces.map(p => `<option>${esc(p)}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><select class="form-select" id="dirtier" onchange="filterDirectory()"><option value="">All tiers</option>${tiersByPrice(cfg).map(t => `<option>${esc(t.name)}</option>`).join('')}</select></div></div>
    <div class="row g-3" id="dirlist"><div class="col-12 text-center py-5"><div class="spinner-border text-primary" role="status"></div></div></div>
    <div class="text-center mt-4" id="dirmore"></div></div></section>`;
}

function filterDirectory() { clearTimeout(dirTimer); dirTimer = setTimeout(() => loadDirectory(), 250); }

async function loadDirectory(more = false) {
  const list = document.getElementById('dirlist'); if (!list) return;
  const seq = ++dirSeq, page = more ? dir.page + 1 : 1;
  const params = new URLSearchParams({ page, pageSize: DIR_PAGE });
  const q = document.getElementById('dirq').value.trim(), province = document.getElementById('dirprov').value, tier = document.getElementById('dirtier').value;
  if (q) params.set('q', q);
  if (province) params.set('province', province);
  if (tier) params.set('tier', tier);
  try {
    const r = await pub(`/directory?${params}`);
    if (seq !== dirSeq) return; // a newer search has started
    dir = { page, total: r.total, items: more ? [...dir.items, ...r.items] : r.items };
  } catch (e) {
    if (seq !== dirSeq) return;
    list.innerHTML = `<div class="col-12">${alertBox('danger', 'exclamation-circle', `${esc(e.message)} <a href="javascript:void 0" onclick="filterDirectory()">Try again</a>.`)}</div>`;
    return;
  }
  list.innerHTML = dir.items.map((m, i) => `<div class="col-md-6 col-lg-4"><div class="card h-100"><div class="card-body">
    <div class="d-flex gap-3 align-items-center mb-3">${avatar(m.name, i)}<div class="min-w-0"><div class="fw-semibold text-truncate">${esc(m.name)}</div><div class="small text-body-secondary">${esc(m.town)}, ${esc(m.province)}</div></div></div>
    <div class="d-flex justify-content-between small mb-3"><span class="text-body-secondary">${esc(m.number)}</span>${tierBadge(esc(m.tier))}</div>
    <div class="d-flex justify-content-between align-items-center"><span class="small text-success-emphasis">${icon('patch-check-fill', 'me-1')}Accredited</span><a href="#/verify/${encodeURIComponent(m.number)}" class="btn btn-sm btn-outline-primary">Verify</a></div>
  </div></div></div>`).join('') || `<div class="col-12">${empty('No members match your search.', 'search')}</div>`;
  document.getElementById('dirmore').innerHTML = dir.items.length < dir.total
    ? `<div class="small text-body-secondary mb-2">Showing ${dir.items.length} of ${dir.total}</div><button class="btn btn-outline-secondary" onclick="loadDirectory(true)">Show more</button>`
    : dir.total ? `<div class="small text-body-secondary">${dir.total} member${dir.total === 1 ? '' : 's'}</div>` : '';
}

export const PUBLIC = { '': home, apply, track, login, verify, directory, 'set-password': setPassword };
expose({
  goSection, wizNext, wizPrev, wizSubmit, trackUpload, trackPay, trackProof, trackCert, trackReceipt, trackResend,
  doLogin, forgotPassword, submitNewPassword, filterDirectory, loadDirectory, toast,
});

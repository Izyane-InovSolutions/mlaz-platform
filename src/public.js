import {
  S, commit, nextId, esc, K, fmtDate, nowLabel, plusYear, TIERDUES, JOINING_FEE, totals, inGoodStanding, findMember, memberById, appById,
  icon, avatar, tierBadge, mofBadge, accredBadge, stageBadge, stepper, readForm, toast, payForm, takePayment,
  setSession, nav, after, expose, empty, saveDoc, accredit, audit, staffFor, STAFF,
} from './ui.js';

/* ================= LAYOUT ================= */
export const brand = (sub = true) => `<a class="navbar-brand d-flex align-items-center gap-2 me-4" href="#/">
  <img src="/mlaz-logo.png" alt="MLAZ" class="brand-logo">
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
          <div class="d-flex align-items-center gap-2 mb-3"><img src="/mlaz-logo.png" alt="MLAZ" class="brand-logo"><span class="fw-bold text-white">Money Lenders Association of Zambia</span></div>
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
const TIER_INFO = {
  Bronze: { who: 'Small and start-up lenders', perks: ['Accreditation certificate', 'Public directory listing', 'Member portal & announcements'] },
  Silver: { who: 'Established lenders', perks: ['Everything in Bronze', 'Discounted workshops & training', 'Compliance resource library'] },
  Gold: { who: 'Large and multi-branch lenders', perks: ['Everything in Silver', 'Priority event registration', 'Featured directory listing'] },
};

function home() {
  const t = totals();
  const recent = S.members.filter(inGoodStanding).sort((a, b) => b.joined.localeCompare(a.joined)).slice(0, 3);
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
            <div class="col-4"><div class="h3 fw-bold mb-0">${t.totalMembers}</div><div class="small text-body-secondary">Registered members</div></div>
            <div class="col-4"><div class="h3 fw-bold mb-0">${t.accredited}</div><div class="small text-body-secondary">Accredited lenders</div></div>
            <div class="col-4"><div class="h3 fw-bold mb-0">${S.events.length}</div><div class="small text-body-secondary">Upcoming events</div></div>
          </div>
        </div>
        <div class="col-lg-6">
          <div class="card border-0 shadow-lg">
            <div class="card-body p-4 p-md-5">
              <div class="d-flex align-items-center gap-3 mb-2"><span class="feature-icon">${icon('shield-check')}</span><div><h2 class="h5 mb-0">Verify a lender</h2><div class="small text-body-secondary">Check before you borrow</div></div></div>
              <p class="small text-body-secondary mt-3">Confirm that a money lender is an accredited MLAZ member authorized by the Ministry of Finance.</p>
              <form onsubmit="event.preventDefault();nav('verify/'+encodeURIComponent(this.q.value.trim()))">
                <div class="input-group input-group-lg">
                  <input name="q" class="form-control" placeholder="Member number or business name" list="memberlist" required>
                  <button class="btn btn-primary" type="submit">Verify</button>
                </div>
                ${memberDatalist()}
              </form>
              <div class="small text-body-secondary mt-2">For example MLA-0421 or “Chingola Finance”</div>
              <hr class="my-4">
              <div class="small fw-semibold text-body-secondary text-uppercase mb-2">Recently accredited</div>
              <div class="list-group list-group-flush">
                ${recent.map((m, i) => `<a href="#/verify/${m.id}" class="list-group-item list-group-item-action d-flex align-items-center gap-3 px-0">${avatar(m.name, i)}<div class="flex-grow-1"><div class="fw-medium">${esc(m.name)}</div><div class="small text-body-secondary">${m.id} · ${esc(m.town)}</div></div>${icon('patch-check-fill', 'text-success')}</a>`).join('')}
              </div>
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
        <p class="text-body-secondary">All tiers include a one-off joining fee of ${K(JOINING_FEE)}. Dues are billed annually on a calendar-year cycle.</p>
      </div>
      <div class="row g-4 justify-content-center">
        ${Object.entries(TIER_INFO).map(([tier, info]) => `<div class="col-md-6 col-lg-4">
          <div class="card h-100 tier-card ${tier === 'Silver' ? 'featured shadow' : ''}">
            <div class="card-body p-4 d-flex flex-column">
              <div class="d-flex justify-content-between align-items-center mb-2"><h3 class="h5 mb-0">${tier}</h3>${tier === 'Silver' ? '<span class="badge text-bg-primary">Most popular</span>' : ''}</div>
              <div class="small text-body-secondary mb-3">${info.who}</div>
              <div class="mb-3"><span class="display-6 fw-bold">${K(TIERDUES[tier])}</span><span class="text-body-secondary"> / year</span></div>
              <ul class="list-unstyled small d-grid gap-2 mb-4">${info.perks.map(p => `<li>${icon('check2', 'text-primary me-2')}${p}</li>`).join('')}</ul>
              <a href="#/apply/${tier}" class="btn ${tier === 'Silver' ? 'btn-primary' : 'btn-outline-primary'} mt-auto">Apply for ${tier}</a>
            </div>
          </div></div>`).join('')}
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
          <div class="d-grid gap-3">
            ${S.announce.slice(0, 3).map(a => `<div class="card"><div class="card-body"><div class="d-flex gap-2 align-items-center small text-body-secondary mb-1"><span class="badge bg-secondary-subtle text-secondary-emphasis">${esc(a.tag)}</span>${fmtDate(a.date)}</div><h3 class="h6 fw-semibold mb-1">${esc(a.title)}</h3><p class="small text-body-secondary mb-0">${esc(a.body)}</p></div></div>`).join('')}
          </div>
        </div>
        <div class="col-lg-5">
          <h2 class="h4 fw-bold mb-4">Upcoming events</h2>
          <div class="list-group">
            ${S.events.slice(0, 4).map(e => { const d = new Date(e.date); return `<div class="list-group-item d-flex gap-3 py-3">
              <div class="text-center border rounded px-2 py-1" style="min-width:56px"><div class="small text-primary fw-semibold text-uppercase">${d.toLocaleString('en-US', { month: 'short' })}</div><div class="h5 mb-0 fw-bold">${d.getDate()}</div></div>
              <div><div class="fw-medium">${esc(e.name)}</div><div class="small text-body-secondary">${esc(e.type)} · ${esc(e.town)}</div></div></div>`; }).join('')}
          </div>
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
const memberDatalist = () => `<datalist id="memberlist">${S.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</datalist>`;

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
const PROVINCES = ['Central', 'Copperbelt', 'Eastern', 'Luapula', 'Lusaka', 'Muchinga', 'North-Western', 'Northern', 'Southern', 'Western'];
const W_STEPS = ['Business', 'Contact', 'Documents', 'Review'];
let W = null;
function apply(tier) {
  W = { step: 0, data: { tier: TIER_INFO[tier] ? tier : 'Silver' }, blobs: {} };
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
    <input class="form-control" name="${name}" type="${opts.type || 'text'}" ${opts.req === false ? '' : 'required'} ${opts.pattern ? `pattern="${opts.pattern}"` : ''} placeholder="${opts.ph || ''}" value="${esc(d[name] || '')}">
    <div class="invalid-feedback">${opts.err || 'This field is required.'}</div></div>`;
  // A file already attached on an earlier visit to this step stays attached, so the input is only required when nothing is on file.
  const file = (name, label, req = true) => `<div class="col-12"><label class="form-label small fw-medium">${label} <span class="text-body-secondary fw-normal">(PDF, JPG or PNG${req ? '' : ', optional'})</span></label>
    <input class="form-control" type="file" name="${name}" accept=".pdf,.jpg,.jpeg,.png" ${req && !d[name] ? 'required' : ''}>${d[name] ? `<div class="form-text">${icon('paperclip')} ${esc(d[name])} attached</div>` : ''}<div class="invalid-feedback">Attach this document.</div></div>`;
  let body = '';
  if (W.step === 0) body = `<h2 class="h5 mb-1">Business details</h2><p class="small text-body-secondary mb-4">As registered with PACRA.</p>
    <div class="row g-3">
      ${f('name', 'Registered business name', { col: 'col-12' })}
      ${f('pacra', 'PACRA registration number', { ph: 'e.g. 120240012345' })}
      ${f('tpin', 'ZRA TPIN', { ph: '10 digits', pattern: '[0-9]{10}', err: 'Enter your 10-digit TPIN.' })}
      ${f('town', 'Town / city')}
      <div class="col-md-6"><label class="form-label small fw-medium">Province</label><select class="form-select" name="province" required><option value="">Select province</option>${PROVINCES.map(p => `<option ${d.province === p ? 'selected' : ''}>${p}</option>`).join('')}</select><div class="invalid-feedback">Select a province.</div></div>
      ${f('address', 'Physical address', { col: 'col-12' })}
      <div class="col-12"><label class="form-label small fw-medium">Membership tier</label><div class="row g-2">
        ${Object.keys(TIER_INFO).map(t => `<div class="col-md-4"><label class="tier-option border rounded p-3 d-flex gap-2 h-100"><input class="form-check-input" type="radio" name="tier" value="${t}" ${d.tier === t ? 'checked' : ''}><span><span class="fw-semibold d-block">${t}</span><span class="small text-body-secondary">${K(TIERDUES[t])} / year</span></span></label></div>`).join('')}
      </div></div>
    </div>`;
  if (W.step === 1) body = `<h2 class="h5 mb-1">Contact person</h2><p class="small text-body-secondary mb-4">We’ll send application updates to this person.</p>
    <div class="row g-3">${f('contact', 'Full name')}${f('position', 'Position', { ph: 'e.g. Managing Director' })}${f('phone', 'Phone number', { type: 'tel', ph: '097 000 0000' })}${f('email', 'Email address', { type: 'email', err: 'Enter a valid email address.' })}</div>`;
  if (W.step === 2) body = `<h2 class="h5 mb-1">Documents</h2><p class="small text-body-secondary mb-4">Company and director documents, and your Ministry of Finance authorization.</p>
    <h3 class="h6 fw-semibold">Company and director</h3>
    <div class="row g-3 mb-4">${file('pacraFile', 'PACRA certificate of incorporation')}
      ${f('director', 'Director full name')}${f('directorNrc', 'Director NRC number', { ph: '000000/00/0', pattern: '[0-9]{6}/[0-9]{2}/[0-9]', err: 'Use the format 000000/00/0.' })}
      ${file('nrcFile', 'Copy of director’s NRC')}</div>
    <h3 class="h6 fw-semibold">Ministry of Finance authorization</h3>
    <div class="alert alert-info small d-flex gap-2">${icon('info-circle')}<div>Don’t have it to hand? You can leave this blank and upload it later from <b>Track application</b>, using the reference you receive.</div></div>
    <div class="row g-3">${f('mofRef', 'Authorization reference', { req: false, ph: 'MoF/ML/2026/0000', col: 'col-12' })}${file('mofFile', 'Authorization document', false)}</div>`;
  if (W.step === 3) {
    const row = (k, v) => `<div class="d-flex justify-content-between py-2 border-bottom small"><span class="text-body-secondary">${k}</span><span class="fw-medium text-end">${v}</span></div>`;
    body = `<h2 class="h5 mb-1">Review and submit</h2><p class="small text-body-secondary mb-4">Please confirm your details are correct.</p>
      <div class="row g-4">
        <div class="col-md-6"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Business</div>${row('Name', esc(d.name))}${row('PACRA no.', esc(d.pacra))}${row('TPIN', esc(d.tpin))}${row('Location', `${esc(d.town)}, ${esc(d.province)}`)}${row('Tier', d.tier)}</div>
        <div class="col-md-6"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Contact</div>${row('Name', esc(d.contact))}${row('Phone', esc(d.phone))}${row('Email', esc(d.email))}${row('Director', `${esc(d.director)} · ${esc(d.directorNrc)}`)}</div>
        <div class="col-12"><div class="small fw-semibold text-uppercase text-body-secondary mb-1">Documents</div>${row('PACRA certificate', esc(d.pacraFile))}${row('Director NRC', esc(d.nrcFile))}${row('MoF authorization', d.mofRef || d.mofFile ? esc([d.mofRef, d.mofFile].filter(Boolean).join(' · ')) : '<span class="text-warning-emphasis">To upload later</span>')}</div>
      </div>
      <div class="bg-body-tertiary rounded p-3 mt-4 small">
        <div class="d-flex justify-content-between"><span>Joining fee (one-off)</span><span>${K(JOINING_FEE)}</span></div>
        <div class="d-flex justify-content-between"><span>${d.tier} annual dues</span><span>${K(TIERDUES[d.tier])}</span></div>
        <div class="d-flex justify-content-between fw-semibold border-top mt-2 pt-2"><span>Payable after MoF verification</span><span>${K(JOINING_FEE + TIERDUES[d.tier])}</span></div>
      </div>
      <div class="form-check mt-4"><input class="form-check-input" type="checkbox" name="declare" id="declare" required><label class="form-check-label small" for="declare">I confirm the information provided is accurate and agree to abide by the MLAZ constitution and code of conduct.</label><div class="invalid-feedback">You must accept the declaration to submit.</div></div>`;
  }
  box.innerHTML = `<div class="mb-4">${stepper(W_STEPS, W.step)}</div><form id="wform" novalidate>${body}</form>
    <div class="d-flex justify-content-between mt-4 pt-3 border-top">
      <button class="btn btn-light" ${W.step === 0 ? 'disabled' : ''} onclick="wizPrev()">${icon('arrow-left', 'me-1')} Back</button>
      ${W.step < 3 ? `<button class="btn btn-primary" onclick="wizNext()">Continue ${icon('arrow-right', 'ms-1')}</button>` : `<button class="btn btn-primary" onclick="wizSubmit(this)">Submit application</button>`}
    </div>`;
}
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
function wizNext() { if (!wizCapture()) return; W.step++; renderWizard(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function wizPrev() { const form = document.getElementById('wform'); const v = {}; form.querySelectorAll('[name]').forEach(el => { if (el.type === 'radio') { if (el.checked) v[el.name] = el.value; } else if (el.type !== 'file' && el.type !== 'checkbox') v[el.name] = el.value.trim(); }); Object.assign(W.data, v); W.step--; renderWizard(); }
async function wizSubmit(btn) {
  if (!wizCapture()) return;
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting…';
  const d = W.data, hasMof = !!(d.mofRef || d.mofFile);
  const app = {
    id: nextId('app', 'APP-'), name: d.name, town: d.town, province: d.province, address: d.address, contact: d.contact, position: d.position,
    phone: d.phone, email: d.email, pacra: d.pacra, tpin: d.tpin, tier: d.tier, stage: hasMof ? 'mof_review' : 'details', submitted: nowLabel(),
    mofRef: hasMof ? (d.mofRef || 'Uploaded document') : '—', mofFile: d.mofFile || '', mofExpiry: hasMof ? plusYear() : '',
    director: d.director, directorNrc: d.directorNrc, pacraFile: d.pacraFile || '', nrcFile: d.nrcFile || '',
  };
  S.apps.unshift(app);
  audit(app.id, 'Application submitted', hasMof ? 'MoF authorization, PACRA certificate and director NRC uploaded' : 'PACRA certificate and director NRC uploaded · MoF authorization to follow', `${d.contact} (applicant)`);
  const entry = S.audit[0];
  // Only confirm once it's saved; otherwise take it back out so submitting again doesn't create a duplicate.
  if (!(await commit())) {
    [[S.apps, app], [S.audit, entry]].forEach(([arr, x]) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); });
    btn.disabled = false; btn.textContent = 'Submit application';
    return;
  }
  await Promise.all(Object.entries(W.blobs).map(([k, file]) => saveDoc(`${app.id}:${k.replace('File', '')}`, file)));
  document.getElementById('wizard').innerHTML = `<div class="text-center py-4">
    <span class="icon-circle bg-success-subtle text-success-emphasis mb-3" style="width:72px;height:72px;font-size:2rem">${icon('check-lg')}</span>
    <h2 class="h4">Application submitted</h2>
    <p class="text-body-secondary">Thank you, ${esc(d.contact)}. We’ve emailed a confirmation to ${esc(d.email)}.</p>
    <div class="d-inline-block bg-body-tertiary rounded px-4 py-3 my-2"><div class="small text-body-secondary">Your application reference</div><div class="h3 fw-bold mb-0 font-monospace">${app.id}</div></div>
    <div class="text-start mx-auto mt-4" style="max-width:440px"><div class="small fw-semibold mb-2">What happens next</div>
      <ol class="small text-body-secondary d-grid gap-1 ps-3 mb-0">
        ${hasMof ? '' : '<li>Upload your Ministry of Finance authorization from Track application.</li>'}
        <li>The Secretariat verifies your MoF authorization (1–2 working days).</li>
        <li>You pay the joining fee and first year’s dues online.</li>
        <li>Your accreditation certificate is issued automatically and your member portal is activated.</li>
      </ol></div>
    <div class="d-flex justify-content-center gap-2 mt-4"><a href="#/" class="btn btn-light">Back to home</a><a href="#/track/${app.id}" class="btn btn-primary">Track application</a></div>
  </div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================= TRACK APPLICATION ================= */
const TRACK_STEPS = ['Submitted', 'MoF authorization', 'Verification', 'Payment', 'Accredited'];
const TRACK_IDX = { details: 1, mof_review: 2, payment_pending: 3, accredited: 5 };
function track(ref) {
  const a = ref ? appById(ref.trim().toUpperCase()) : null;
  let result = '';
  if (ref && !a) result = `<div class="alert alert-warning d-flex gap-2">${icon('exclamation-triangle')}<div>No application found with reference <b>${esc(ref)}</b>. Check the reference in your confirmation email.</div></div>`;
  if (a) {
    let action = '';
    if (a.stage === 'details') action = `${a.note ? `<div class="alert alert-danger small d-flex gap-2">${icon('arrow-return-left')}<div><b>Returned by the Secretariat:</b> ${esc(a.note)}</div></div>` : ''}
      <h3 class="h6 fw-semibold">Upload your Ministry of Finance authorization</h3>
      <form id="mofform" class="row g-3" novalidate onsubmit="event.preventDefault();trackUpload('${a.id}')">
        <div class="col-12"><label class="form-label small fw-medium">Authorization reference</label><input class="form-control" name="mofRef" required placeholder="MoF/ML/2026/0000"><div class="invalid-feedback">Required.</div></div>
        <div class="col-12"><label class="form-label small fw-medium">Document</label><input class="form-control" type="file" name="mofFile" accept=".pdf,.jpg,.jpeg,.png" required><div class="invalid-feedback">Attach the authorization document.</div></div>
        <div class="col-12"><button class="btn btn-primary">Submit for verification</button></div>
      </form>`;
    if (a.stage === 'mof_review') action = `<div class="alert alert-info d-flex gap-2 mb-0">${icon('hourglass-split')}<div>Your authorization <b>${esc(a.mofRef)}</b> is being verified by the Secretariat. This usually takes 1–2 working days. We’ll email you when it’s done.</div></div>`;
    if (a.stage === 'payment_pending' && a.paymentPending) action = `<div class="alert alert-info d-flex gap-2 mb-0">${icon('hourglass-split')}<div>We’ve received your proof of payment for <b>${K(JOINING_FEE + TIERDUES[a.tier])}</b>. MLAZ Finance will confirm the transfer, usually within 1 working day, and your accreditation certificate is issued automatically once it’s confirmed.</div></div>`;
    else if (a.stage === 'payment_pending') {
      const fee = JOINING_FEE + TIERDUES[a.tier];
      action = `<div class="alert alert-success d-flex gap-2">${icon('check-circle')}<div>Your MoF authorization has been verified. Complete payment to receive your accreditation.</div></div>
      <div class="row g-4">
        <div class="col-md-6"><div class="bg-body-tertiary rounded p-3 small">
          <div class="d-flex justify-content-between"><span>Joining fee</span><span>${K(JOINING_FEE)}</span></div>
          <div class="d-flex justify-content-between"><span>${a.tier} annual dues</span><span>${K(TIERDUES[a.tier])}</span></div>
          <div class="d-flex justify-content-between fw-semibold border-top mt-2 pt-2"><span>Total due</span><span>${K(fee)}</span></div></div></div>
        <div class="col-md-6">${payForm('tpay', { phone: a.phone, reference: a.id })}
          <button class="btn btn-primary w-100 mt-3" onclick="trackPay('${a.id}')">Pay ${K(fee)}</button></div>
      </div>`;
    }
    if (a.stage === 'accredited') { const m = memberById(a.memberId); action = `<div class="alert alert-success d-flex gap-2">${icon('award')}<div>Congratulations — you are now an accredited MLAZ member. Your member number is <b>${a.memberId}</b>.</div></div>
      <p class="small">Your certificate has been emailed to you. Sign in to the member portal with <b>${esc(m?.email || a.email)}</b> to manage your membership.</p>
      <div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-primary" onclick="viewCert('${a.memberId}')">${icon('award', 'me-1')} View certificate</button><a class="btn btn-primary" href="#/login/member">Go to member portal</a></div>`; }
    result = `<div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5">
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-4"><div><div class="small text-body-secondary font-monospace">${a.id}</div><h2 class="h4 mb-0">${esc(a.name)}</h2><div class="small text-body-secondary">${esc(a.town)} · ${a.tier} tier · submitted ${esc(a.submitted)}</div></div>${stageBadge(a.stage)}</div>
      <div class="mb-4">${stepper(TRACK_STEPS, TRACK_IDX[a.stage])}</div>${action}</div></div>`;
  }
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container" style="max-width:860px">
    <h1 class="h2 fw-bold mb-1">Track your application</h1><p class="text-body-secondary">Enter the reference from your confirmation email, e.g. APP-2042.</p>
    <form class="d-flex gap-2 mb-4" onsubmit="event.preventDefault();nav('track/'+encodeURIComponent(this.ref.value.trim()))">
      <input class="form-control form-control-lg" name="ref" placeholder="Application reference" value="${esc(ref || '')}" required>
      <button class="btn btn-primary btn-lg px-4">Track</button>
    </form>${result}</div></section>`;
}
function trackUpload(id) {
  const form = document.getElementById('mofform'), v = readForm(form); if (!v) return;
  const a = appById(id);
  saveDoc(`${id}:mof`, form.querySelector('[name=mofFile]').files[0]);
  Object.assign(a, { stage: 'mof_review', note: '', mofRef: v.mofRef, mofExpiry: plusYear(), mofFile: v.mofFile, recommendation: null });
  audit(id, 'MoF authorization uploaded', v.mofRef, `${a.contact} (applicant)`);
  commit(); toast('Authorization submitted for verification'); nav('track/' + id);
}
function trackPay(id) {
  const a = appById(id), fee = JOINING_FEE + TIERDUES[a.tier];
  takePayment('tpay', {
    payer: a.name, description: `Joining fee & ${a.tier} dues`, link: { app: a.id },
    items: [{ type: 'Joining fee', amt: JOINING_FEE }, { type: `Annual dues (${a.tier})`, amt: TIERDUES[a.tier] }],
    onDone: ({ refs, pending, method, detail }) => {
      if (pending) { a.paymentPending = refs; audit(id, 'Proof of payment submitted', `${K(fee)} · bank transfer · ref ${detail}`, `${a.contact} (applicant)`); }
      else { audit(id, 'Payment received', `${K(fee)} · ${method} · ${refs.join(', ')}`, `${a.contact} (applicant)`); accredit(a); }
      setTimeout(() => nav('track/' + id), 50);
    },
  });
}

/* ================= LOGIN ================= */
const DEMO = { member: 'info@quicklend.zm', admin: 'secretariat@mlaz.org.zm' };
function login(role) {
  role = role === 'admin' ? 'admin' : 'member';
  const member = role === 'member';
  return `<section class="py-5 bg-body-tertiary min-vh-75 d-flex align-items-center"><div class="container"><div class="row justify-content-center"><div class="col-md-8 col-lg-5">
    <div class="card border-0 shadow-sm"><div class="card-body p-4 p-md-5">
      <div class="text-center mb-4"><span class="brand-mark lg">${icon(member ? 'building' : 'person-badge')}</span><h1 class="h4 mt-3 mb-1">${member ? 'Member portal' : 'Secretariat sign in'}</h1><p class="small text-body-secondary mb-0">${member ? 'Manage your membership, dues and certificates.' : 'MLAZ staff access to the administration console.'}</p></div>
      <ul class="nav nav-pills nav-fill bg-body-tertiary rounded p-1 mb-4 small">
        <li class="nav-item"><a class="nav-link ${member ? 'active' : ''}" href="#/login/member">Member</a></li>
        <li class="nav-item"><a class="nav-link ${member ? '' : 'active'}" href="#/login/admin">Secretariat</a></li>
      </ul>
      <div id="loginerr"></div>
      <form onsubmit="event.preventDefault();doLogin('${role}',this)" novalidate>
        <div class="mb-3"><label class="form-label small fw-medium">Email address</label><input class="form-control form-control-lg" type="email" name="email" value="${DEMO[role]}" autocomplete="username" required></div>
        <div class="mb-3"><label class="form-label small fw-medium">Password</label><input class="form-control form-control-lg" type="password" name="password" value="demo1234" autocomplete="current-password" required></div>
        <div class="d-flex justify-content-between align-items-center mb-4 small">
          <div class="form-check"><input class="form-check-input" type="checkbox" id="remember" checked><label class="form-check-label" for="remember">Keep me signed in</label></div>
          <a href="javascript:void 0" onclick="toast('If the address is registered, a reset link has been sent')">Forgot password?</a>
        </div>
        <button class="btn btn-primary btn-lg w-100">Sign in</button>
      </form>
      ${member ? '<p class="text-center small mt-4 mb-0 text-body-secondary">Not a member yet? <a href="#/apply">Apply for membership</a></p>'
        : `<div class="small text-body-secondary mt-4"><div class="fw-medium mb-1">Demo staff accounts</div>${Object.entries(STAFF).map(([e, st]) => `<div>${esc(e)} · ${esc(st.title)}</div>`).join('')}</div>`}
    </div></div>
    
  </div></div></div></section>`;
}
function doLogin(role, form) {
  const email = form.email.value.trim().toLowerCase(), pwd = form.password.value;
  const err = msg => { document.getElementById('loginerr').innerHTML = `<div class="alert alert-danger small d-flex gap-2">${icon('exclamation-circle')}<div>${msg}</div></div>`; };
  if (!email || !pwd) return err('Enter your email address and password.');
  if (role === 'admin') {
    if (!email.endsWith('@mlaz.org.zm')) return err('This account does not have Secretariat access.');
    setSession({ role: 'admin', email, name: staffFor(email).name });
    return nav('app/dashboard');
  }
  const m = S.members.find(x => String(x.email).toLowerCase() === email);
  if (!m) return err('We couldn’t find a member account with that email address.');
  setSession({ role: 'member', memberId: m.id, email });
  nav('app/overview');
}

/* ================= VERIFY & DIRECTORY ================= */
export function verifyResult(q) {
  if (!q) return '';
  const m = findMember(q);
  if (!m) return `<div class="card border-danger-subtle"><div class="card-body p-4 d-flex gap-3"><span class="icon-circle bg-danger-subtle text-danger-emphasis" style="width:48px;height:48px;font-size:1.4rem">${icon('x-octagon')}</span>
    <div><h2 class="h5 mb-1">No MLAZ member found for “${esc(q)}”</h2><p class="small text-body-secondary mb-0">This lender does not appear in the MLAZ register. Proceed with caution and report suspicious lenders to the Secretariat.</p></div></div></div>`;
  const ok = inGoodStanding(m);
  const row = (k, v) => `<div class="col-sm-6"><div class="small text-body-secondary">${k}</div><div class="fw-medium">${v}</div></div>`;
  return `<div class="card ${ok ? 'border-success-subtle' : 'border-danger-subtle'}"><div class="card-body p-4">
    <div class="d-flex gap-3 align-items-center mb-4"><span class="icon-circle ${ok ? 'bg-success-subtle text-success-emphasis' : 'bg-danger-subtle text-danger-emphasis'}" style="width:48px;height:48px;font-size:1.4rem">${icon(ok ? 'patch-check-fill' : 'exclamation-octagon')}</span>
      <div><h2 class="h5 mb-0">${ok ? 'Verified — accredited member in good standing' : 'Not an active accredited member'}</h2><div class="small text-body-secondary">Checked ${fmtDate(new Date())}</div></div></div>
    <div class="row g-3">${row('Member', esc(m.name))}${row('Member number', m.id)}${row('Town', esc(m.town))}${row('Tier', tierBadge(m.tier))}${row('MoF authorization', mofBadge(m.mof))}${row('MLAZ accreditation', accredBadge(m.accred))}${row('Valid until', fmtDate(m.expiry))}</div>
    ${ok ? '' : `<div class="alert alert-danger small mt-4 mb-0">${icon('exclamation-triangle', 'me-1')}This lender is not currently an active accredited MLAZ member. Proceed with caution.</div>`}
  </div></div>`;
}
function verify(q) {
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container" style="max-width:760px">
    <h1 class="h2 fw-bold mb-1">Verify a lender</h1><p class="text-body-secondary">Enter a member number or business name, or scan the QR code on a certificate.</p>
    <form class="d-flex gap-2 mb-4" onsubmit="event.preventDefault();nav('verify/'+encodeURIComponent(this.q.value.trim()))">
      <input class="form-control form-control-lg" name="q" list="memberlist" placeholder="e.g. MLA-0421 or QuickLend" value="${esc(q || '')}" required>
      <button class="btn btn-primary btn-lg px-4">Verify</button>${memberDatalist()}
    </form>${verifyResult(q)}</div></section>`;
}
function directory() {
  after(() => filterDirectory());
  const towns = [...new Set(S.members.filter(inGoodStanding).map(m => m.town))].sort();
  return `<section class="py-5 bg-body-tertiary min-vh-75"><div class="container">
    <h1 class="h2 fw-bold mb-1">Member directory</h1><p class="text-body-secondary">Accredited money lenders in good standing with MLAZ.</p>
    <div class="row g-2 mb-4"><div class="col-md-8"><div class="input-group"><span class="input-group-text bg-white">${icon('search')}</span><input class="form-control" id="dirq" placeholder="Search by name or member number" oninput="filterDirectory()"></div></div>
      <div class="col-md-4"><select class="form-select" id="dirtown" onchange="filterDirectory()"><option value="">All towns</option>${towns.map(t => `<option>${esc(t)}</option>`).join('')}</select></div></div>
    <div class="row g-3" id="dirlist"></div></div></section>`;
}
function filterDirectory() {
  const q = (document.getElementById('dirq')?.value || '').toLowerCase(), town = document.getElementById('dirtown')?.value;
  const list = S.members.filter(inGoodStanding).filter(m => (m.name + m.id).toLowerCase().includes(q) && (!town || m.town === town));
  document.getElementById('dirlist').innerHTML = list.map((m, i) => `<div class="col-md-6 col-lg-4"><div class="card h-100"><div class="card-body">
    <div class="d-flex gap-3 align-items-center mb-3">${avatar(m.name, i)}<div class="min-w-0"><div class="fw-semibold text-truncate">${esc(m.name)}</div><div class="small text-body-secondary">${esc(m.town)}</div></div></div>
    <div class="d-flex justify-content-between small mb-3"><span class="text-body-secondary">${m.id}</span>${tierBadge(m.tier)}</div>
    <div class="d-flex justify-content-between align-items-center"><span class="small text-success-emphasis">${icon('patch-check-fill', 'me-1')}Accredited</span><a href="#/verify/${m.id}" class="btn btn-sm btn-outline-primary">Verify</a></div>
  </div></div></div>`).join('') || `<div class="col-12">${empty('No members match your search.', 'search')}</div>`;
}

export const PUBLIC = { '': home, apply, track, login, verify, directory };
expose({ goSection, wizNext, wizPrev, wizSubmit, trackUpload, trackPay, doLogin, filterDirectory, toast });

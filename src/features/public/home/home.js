import { pub } from '../../../core/api/client.js';
import { publicConfig } from '../../../core/reference-data.js';
import { EL, on } from '../../../core/events.js';
import { K, avatar, empty, esc, fmtDate, icon } from '../../../shared/ui/index.js';
import { EVENT_TYPE } from '../../common/index.js';
import { tiersByPrice } from '../shared/tiers.js';

const soft = (p, fallback = null) => p.catch(() => fallback); // optional sections degrade instead of breaking the page
const unavailable = what => `<p class="small text-body-secondary">${icon('cloud-slash', 'me-1')}${what} couldn’t be loaded right now.</p>`;

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

export async function home() {
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
            <div class="col-4"><div class="h3 fw-bold mb-0">${esc(stats?.accreditedMembers ?? '—')}</div><div class="small text-body-secondary">Accredited lenders</div></div>
            <div class="col-4"><div class="h3 fw-bold mb-0">${esc(stats?.provinces ?? '—')}</div><div class="small text-body-secondary">Provinces covered</div></div>
            <div class="col-4"><div class="h3 fw-bold mb-0">${events ? events.length : '—'}</div><div class="small text-body-secondary">Upcoming events</div></div>
          </div>
        </div>
        <div class="col-lg-6">
          <div class="card border-0 shadow-lg">
            <div class="card-body p-4 p-md-5">
              <div class="d-flex align-items-center gap-3 mb-2"><span class="feature-icon">${icon('shield-check')}</span><div><h2 class="h5 mb-0">Verify a lender</h2><div class="small text-body-secondary">Check before you borrow</div></div></div>
              <p class="small text-body-secondary mt-3">Confirm that a money lender is an accredited MLAZ member authorized by the Ministry of Finance.</p>
              <form ${on('submit', 'verifySearch', EL)}>
                <div class="input-group input-group-lg">
                  <input name="q" class="form-control" aria-label="Member number or business name" placeholder="Member number or business name" minlength="3" required>
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
      <div class="text-center mx-auto mb-5 mw-640">
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
      <div class="text-center mx-auto mb-5 mw-640">
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
      <div class="text-center mx-auto mb-5 mw-640">
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
              <div class="text-center border rounded px-2 py-1 minw-56"><div class="small text-primary fw-semibold text-uppercase">${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}</div><div class="h5 mb-0 fw-bold">${Number(d.getUTCDate()) || ''}</div></div>
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

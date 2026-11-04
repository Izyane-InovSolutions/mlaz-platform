import { getSession } from '../../../core/auth/session-store.js';
import { expose, on } from '../../../core/events.js';
import { nav } from '../../../core/navigation.js';
import { esc, icon, safeUrl } from '../../../shared/ui/index.js';

/* ================= LAYOUT ================= */
const brand = (sub = true) => `<a class="navbar-brand d-flex align-items-center gap-2 me-4" href="#/">
  <span class="brand-mark">${icon('shield-check')}</span>
  <span class="lh-sm"><span class="d-block fw-bold">MLAZ</span>${sub ? '<span class="d-none d-sm-block text-body-secondary brand-sub">Money Lenders Association of Zambia</span>' : ''}</span></a>`;

export function publicLayout(inner, active) {
  const session = getSession(); // signed-in visitors get a way back to their console instead of "Sign in"
  const link = (href, label, key) => `<li class="nav-item"><a class="nav-link ${active === key ? 'active fw-medium' : ''}" href="${esc(safeUrl(href, 'self'))}">${label}</a></li>`;
  return `
  <nav class="navbar navbar-expand-lg bg-white border-bottom sticky-top py-2">
    <div class="container">
      ${brand()}
      <button class="navbar-toggler border-0" type="button" data-bs-toggle="collapse" data-bs-target="#pubnav" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
      <div class="collapse navbar-collapse" id="pubnav">
        <ul class="navbar-nav me-auto">
          <li class="nav-item"><a class="nav-link" href="#" role="button" ${on('click', 'goSection', 'about')}>About</a></li>
          <li class="nav-item"><a class="nav-link" href="#" role="button" ${on('click', 'goSection', 'membership')}>Membership</a></li>
          ${link('#/verify', 'Verify a lender', 'verify')}
          ${link('#/directory', 'Directory', 'directory')}
          ${link('#/track', 'Track application', 'track')}
        </ul>
        <div class="d-flex flex-column flex-lg-row gap-2 py-2 py-lg-0">
          ${session ? `<a class="btn btn-outline-secondary" href="#/app">${icon(session.role === 'admin' ? 'person-badge' : 'building', 'me-1')} ${session.role === 'admin' ? 'Secretariat console' : 'Member portal'}</a>` : `<div class="dropdown">
            <button class="btn btn-outline-secondary dropdown-toggle w-100" data-bs-toggle="dropdown">${icon('box-arrow-in-right', 'me-1')} Sign in</button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
              <li><a class="dropdown-item py-2" href="#/login/member">${icon('building', 'me-2 text-primary')}Member portal</a></li>
              <li><a class="dropdown-item py-2" href="#/login/admin">${icon('person-badge', 'me-2 text-primary')}Secretariat</a></li>
            </ul>
          </div>`}
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

// The About and Membership links scroll to a section of the landing page, opening it first when needed.
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

expose({ goSection });

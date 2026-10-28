import '@fontsource-variable/inter';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles.scss';
import 'bootstrap';
import { Offcanvas } from 'bootstrap';
import { getSession, setSession, setRenderer, flushAfter, closeAllModals, nav, expose, icon, esc, initials, after, rerender, toast, STAFF, staffFor } from './ui.js';
import { PUBLIC, publicLayout, scrollPendingSection } from './public.js';
import { ADMIN_NAV, ADMIN_PAGES, adminSearch } from './admin.js';
import { MEMBER_NAV, MEMBER_PAGES, currentMember } from './member.js';

/* ================= APP SHELL ================= */
function appLayout(session, page, inner) {
  const admin = session.role === 'admin';
  const navDef = admin ? ADMIN_NAV : MEMBER_NAV;
  const m = admin ? null : currentMember();
  const st = admin && staffFor(session.email);
  const user = admin ? { name: st.name, sub: st.title, init: initials(st.name) } : { name: m.contact, sub: m.name, init: initials(m.name) };
  // Demo only: lets one person play both maker and checker without signing out.
  const switchTo = admin ? Object.entries(STAFF).filter(([e]) => e !== session.email).map(([e, o]) => `<li><a class="dropdown-item" href="javascript:void 0" onclick="switchStaff('${e}')">${icon('arrow-left-right', 'me-2')}Switch to ${esc(o.name)} <span class="small text-body-secondary">(${esc(o.title)})</span></a></li>`).join('') : '';
  const sidebar = navDef.map(([section, items]) => `<div class="nav-section">${section}</div>` + items.map(([id, label, ic, badge]) => {
    const n = badge ? badge() : 0;
    return `<a class="nav-link ${id === page ? 'active' : ''}" href="#/app/${id}">${icon(ic)}<span>${label}</span>${n ? `<span class="badge rounded-pill text-bg-danger">${n}</span>` : ''}</a>`;
  }).join('')).join('');
  return `
  <aside class="app-sidebar offcanvas-lg offcanvas-start" tabindex="-1" id="sidebar">
    <div class="offcanvas-header">
      <a href="#/" class="d-flex align-items-center gap-2 text-white"><span class="brand-mark">${icon('shield-check')}</span><span class="lh-sm"><span class="d-block fw-bold">MLAZ</span><span class="small opacity-75">${admin ? 'Secretariat console' : 'Member portal'}</span></span></a>
      <button type="button" class="btn-close btn-close-white d-lg-none" data-bs-dismiss="offcanvas" data-bs-target="#sidebar" aria-label="Close"></button>
    </div>
    <div class="offcanvas-body">
      <a href="#/" class="sidebar-brand d-none d-lg-flex align-items-center gap-2 text-white"><span class="brand-mark">${icon('shield-check')}</span><span class="lh-sm"><span class="d-block fw-bold">MLAZ</span><span class="small opacity-75">${admin ? 'Secretariat console' : 'Member portal'}</span></span></a>
      <nav class="nav flex-column">${sidebar}</nav>
      <div class="mt-auto pt-4 small opacity-50 px-2"><span class="ms-lg-auto d-flex align-items-center gap-2">Platform by <a href="https://izyane.com" target="_blank" class="text-decoration-underline"><span class="footer-logo"><img src="/izyane-white.png" alt="iZyane"></span></a></span></div>
    </div>
  </aside>
  <div class="app-main">
    <header class="app-topbar">
      <div class="d-flex align-items-center gap-3 px-3 px-lg-4 py-2">
        <button class="btn btn-light d-lg-none" data-bs-toggle="offcanvas" data-bs-target="#sidebar" aria-label="Menu">${icon('list')}</button>
        ${admin ? `<div class="app-search flex-grow-1 dropdown">
          <div class="input-group"><span class="input-group-text bg-body-tertiary border-end-0">${icon('search')}</span><input class="form-control bg-body-tertiary border-start-0" id="topsearch" placeholder="Search members and applications" autocomplete="off" oninput="topSearch(this.value)"></div>
          <div class="dropdown-menu shadow-sm" id="searchres"></div></div>` : ''}
        <div class="ms-auto d-flex align-items-center gap-2">
          <a class="btn btn-light d-none d-md-inline-flex align-items-center gap-1" href="#/" title="Public website">${icon('globe')}<span class="small">Website</span></a>
          <div class="dropdown">
            <button class="btn btn-light d-flex align-items-center gap-2 py-1" data-bs-toggle="dropdown">
              <span class="avatar" style="background:var(--brand-dark)">${esc(user.init)}</span>
              <span class="text-start d-none d-sm-block lh-sm"><span class="d-block small fw-semibold">${esc(user.name)}</span><span class="small text-body-secondary">${esc(user.sub)}</span></span>
              ${icon('chevron-down', 'small text-body-secondary')}
            </button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
              ${admin ? switchTo : `<li><a class="dropdown-item" href="#/app/profile">${icon('building', 'me-2')}Business profile</a></li>`}
              <li><a class="dropdown-item" href="#/">${icon('globe', 'me-2')}Public website</a></li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item text-danger" href="javascript:void 0" onclick="logout()">${icon('box-arrow-right', 'me-2')}Sign out</a></li>
            </ul>
          </div>
        </div>
      </div>
    </header>
    <main class="p-3 p-lg-4">${inner}</main>
  </div>`;
}

function topSearch(q) {
  const box = document.getElementById('searchres');
  const html = adminSearch(q);
  box.innerHTML = html; box.classList.toggle('show', !!html);
}
document.addEventListener('click', e => { if (!e.target.closest('.app-search')) document.getElementById('searchres')?.classList.remove('show'); });

function logout() { setSession(null); nav(''); }
function switchStaff(email) { setSession({ role: 'admin', email, name: staffFor(email).name }); rerender(); toast(`Signed in as ${staffFor(email).name}`); }

/* ================= ROUTER ================= */
let lastHash = null;
function route() {
  const [a = '', b, c] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const root = document.getElementById('root');
  if (location.hash !== lastHash) { closeAllModals(); Offcanvas.getInstance(document.getElementById('sidebar'))?.hide(); }

  if (a === 'app') {
    const s = getSession();
    if (!s || (s.role === 'member' && !currentMember())) { setSession(null); return nav('login/member'); }
    const pages = s.role === 'admin' ? ADMIN_PAGES : MEMBER_PAGES;
    const page = pages[b] ? b : Object.keys(pages)[0];
    root.innerHTML = appLayout(s, page, pages[page](c));
    document.title = `${page.charAt(0).toUpperCase() + page.slice(1)} · MLAZ ${s.role === 'admin' ? 'Secretariat' : 'Member portal'}`;
  } else {
    const view = PUBLIC[a] || PUBLIC[''];
    root.innerHTML = publicLayout(view(b), a);
    document.title = 'MLAZ — Money Lenders Association of Zambia';
  }
  flushAfter();
  if (!scrollPendingSection() && location.hash !== lastHash) window.scrollTo(0, 0);
  lastHash = location.hash;
}

expose({ topSearch, logout, switchStaff });
setRenderer(route);
window.addEventListener('hashchange', route);
route();

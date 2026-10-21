import '@fontsource-variable/inter';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles.scss';
import 'bootstrap';
import { Offcanvas } from 'bootstrap';
import { getSession, setSession, setRenderer, flushAfter, clearAfter, closeAllModals, nav, expose, icon, esc, initials } from './ui.js';
import { can, ensureSession, signOut } from './api.js';
import { PUBLIC, publicLayout, scrollPendingSection } from './public.js';
import { ADMIN_NAV, ADMIN_PAGES, ADMIN_PAGE_PERM, adminSearch, refreshNavCounts } from './admin.js';
import { MEMBER_NAV, MEMBER_PAGES, refreshMember } from './member.js';

/* ================= APP SHELL ================= */
function appLayout(session, page, inner) {
  const admin = session.role === 'admin';
  const navDef = admin ? ADMIN_NAV : MEMBER_NAV;
  const user = admin ? { name: session.name, sub: session.title, init: initials(session.name) } : { name: session.name, sub: session.memberName || '', init: initials(session.memberName || session.name) };
  // Only the pages the signed-in role can open; a section with nothing left is dropped.
  const sidebar = navDef.map(([section, items]) => {
    const visible = items.filter(it => !admin || !it[4] || can(it[4]));
    return visible.length ? `<div class="nav-section">${section}</div>` + visible.map(([id, label, ic, badge]) => {
      const n = badge ? badge() : 0;
      return `<a class="nav-link ${id === page ? 'active' : ''}" href="#/app/${id}">${icon(ic)}<span>${label}</span>${n ? `<span class="badge rounded-pill text-bg-danger">${n}</span>` : ''}</a>`;
    }).join('') : '';
  }).join('');
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
              ${admin ? `<li><span class="dropdown-item-text small text-body-secondary">${esc(session.email)}</span></li>` : `<li><a class="dropdown-item" href="#/app/profile">${icon('building', 'me-2')}Business profile</a></li>`}
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

// Console search: debounced, and only the latest query's results are shown.
let searchTimer = null, searchSeq = 0;
function topSearch(q) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq, box = document.getElementById('searchres');
    let html;
    try { html = await adminSearch(q); } catch (e) { html = `<span class="dropdown-item-text small text-danger">${esc(e.message)}</span>`; }
    if (seq !== searchSeq || !box) return;
    box.innerHTML = html; box.classList.toggle('show', !!html);
  }, 250);
}
document.addEventListener('click', e => { if (!e.target.closest('.app-search')) document.getElementById('searchres')?.classList.remove('show'); });

async function logout() { await signOut(); nav(''); }

/* ================= ROUTER ================= */
const loading = () => `<div class="d-flex justify-content-center align-items-center py-5 min-vh-75"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading…</span></div></div>`;
const failed = e => `<section class="py-5 min-vh-75"><div class="container" style="max-width:640px"><div class="card border-danger-subtle"><div class="card-body p-4 d-flex gap-3">
  <span class="icon-circle bg-danger-subtle text-danger-emphasis" style="width:48px;height:48px;font-size:1.4rem">${icon(e?.code === 'NETWORK' ? 'wifi-off' : 'exclamation-octagon')}</span>
  <div><h2 class="h5 mb-1">This page couldn’t be loaded</h2><p class="small text-body-secondary mb-3">${esc(e?.message || 'Something went wrong.')}</p>
  <button class="btn btn-primary btn-sm" onclick="rerender()">${icon('arrow-clockwise', 'me-1')}Try again</button></div></div></div></div></section>`;

let lastHash = null, renderSeq = 0;
async function route() {
  const seq = ++renderSeq;
  // Links in emails carry a query string, e.g. #/track/APP-2045?t=… or #/set-password?token=…
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [a = '', b, c] = path.split('/').map(decodeURIComponent);
  const root = document.getElementById('root');
  const sameView = location.hash === lastHash;
  if (!sameView) { closeAllModals(); Offcanvas.getInstance(document.getElementById('sidebar'))?.hide(); }

  if (a === 'app') {
    let s = getSession();
    const admin = s?.role === 'admin';
    const toLogin = () => { setSession(null); nav(admin ? 'login/admin' : 'login/member'); };
    // The access token lives in memory only: after a reload it is restored from the httpOnly session cookie.
    if (!s || !(await ensureSession())) return seq === renderSeq ? toLogin() : undefined;
    if (seq !== renderSeq) return;
    s = getSession();
    if (admin && s.mfaSetupRequired) return nav('secure-account');
    const pages = admin ? ADMIN_PAGES : MEMBER_PAGES;
    const allowed = id => !!pages[id] && (!admin || !ADMIN_PAGE_PERM[id] || can(ADMIN_PAGE_PERM[id]));
    const page = allowed(b) ? b : Object.keys(pages).find(allowed);
    document.title = `${page.charAt(0).toUpperCase() + page.slice(1)} · MLAZ ${admin ? 'Secretariat' : 'Member portal'}`;
    const out = pages[page](c, new URLSearchParams(query));
    if (out instanceof Promise) {
      if (!sameView || !root.querySelector('.app-main')) root.innerHTML = appLayout(s, page, loading());
      let inner;
      try { [inner] = await Promise.all([out, admin ? refreshNavCounts() : refreshMember()]); } catch (e) {
        if (e.status === 401 || !getSession()) { if (seq === renderSeq) toLogin(); return; } // session ended
        inner = failed(e);
      }
      if (seq !== renderSeq) { clearAfter(); return; }
      root.innerHTML = appLayout(getSession() || s, page, inner);
    } else {
      root.innerHTML = appLayout(s, page, out);
    }
  } else {
    const view = PUBLIC[a] || PUBLIC[''];
    document.title = 'MLAZ — Money Lenders Association of Zambia';
    const out = view(b, new URLSearchParams(query));
    if (out instanceof Promise) {
      // Pages that load from the API: show a spinner on arrival, keep the old content while refreshing in place.
      if (!sameView || !root.querySelector('main')) root.innerHTML = publicLayout(loading(), a);
      let inner;
      try { inner = await out; } catch (e) { inner = failed(e); }
      if (seq !== renderSeq) { clearAfter(); return; } // the user has already moved on
      root.querySelector('main').innerHTML = inner;
    } else {
      root.innerHTML = publicLayout(out, a);
    }
  }
  flushAfter();
  if (!scrollPendingSection() && location.hash !== lastHash) window.scrollTo(0, 0);
  lastHash = location.hash;
}

expose({ topSearch, logout });
setRenderer(route);
window.addEventListener('hashchange', route);
route();

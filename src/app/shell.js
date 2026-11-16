import { can } from '../core/auth/permissions.js';
import { signOut } from '../core/auth/session.js';
import { EL, expose, on } from '../core/events.js';
import { nav } from '../core/navigation.js';
import { esc, icon, initials } from '../shared/ui/index.js';
import { ADMIN_NAV, adminSearch } from '../features/admin/index.js';
import { MEMBER_NAV } from '../features/member/index.js';

/* ================= APP SHELL ================= */
export function appLayout(session, page, inner) {
  const admin = session.role === 'admin';
  const navDef = admin ? ADMIN_NAV : MEMBER_NAV;
  const user = admin ? { name: session.name, sub: session.title, init: initials(session.name) } : { name: session.name, sub: session.memberName || '', init: initials(session.memberName || session.name) };
  // Only the pages the signed-in role can open; a section with nothing left is dropped.
  const sidebar = navDef.map(([section, items]) => {
    const visible = items.filter(it => !admin || !it[4] || can(it[4]));
    return visible.length ? `<div class="nav-section">${section}</div>` + visible.map(([id, label, ic, badge]) => {
      const n = badge ? badge() : 0;
      return `<a class="nav-link ${id === page ? 'active' : ''}" href="#/app/${encodeURIComponent(id)}">${icon(ic)}<span>${label}</span>${n ? `<span class="badge rounded-pill text-bg-danger">${n}</span>` : ''}</a>`;
    }).join('') : '';
  }).join('');
  return `
  <aside class="app-sidebar offcanvas-lg offcanvas-start" tabindex="-1" id="sidebar">
    <div class="offcanvas-header">
      <a href="#/app" class="d-flex align-items-center gap-2 text-white"><img src="/mlaz-logo.png" alt="" class="brand-logo"><span class="lh-sm"><span class="d-block fw-bold">MLAZ</span><span class="small opacity-75">${admin ? 'Secretariat console' : 'Member portal'}</span></span></a>
      <button type="button" class="btn-close btn-close-white d-lg-none" data-bs-dismiss="offcanvas" data-bs-target="#sidebar" aria-label="Close"></button>
    </div>
    <div class="offcanvas-body">
      <a href="#/app" class="sidebar-brand d-none d-lg-flex align-items-center gap-2 text-white"><img src="/mlaz-logo.png" alt="" class="brand-logo"><span class="lh-sm"><span class="d-block fw-bold">MLAZ</span><span class="small opacity-75">${admin ? 'Secretariat console' : 'Member portal'}</span></span></a>
      <nav class="nav flex-column">${sidebar}</nav>
      <div class="mt-auto pt-4 small opacity-50 px-2"><span class="ms-lg-auto d-flex align-items-center gap-2">Platform by <a href="https://izyane.com" target="_blank" class="text-decoration-underline"><span class="footer-logo"><img src="/izyane-white.png" alt="iZyane"></span></a></span></div>
    </div>
  </aside>
  <div class="app-main">
    <header class="app-topbar">
      <div class="d-flex align-items-center gap-3 px-3 px-lg-4 py-2">
        <button class="btn btn-light d-lg-none" data-bs-toggle="offcanvas" data-bs-target="#sidebar" aria-label="Menu">${icon('list')}</button>
        ${admin ? `<div class="app-search flex-grow-1 dropdown">
          <div class="input-group"><span class="input-group-text bg-body-tertiary border-end-0">${icon('search')}</span><input class="form-control bg-body-tertiary border-start-0" id="topsearch" type="search" aria-label="Search members and applications" placeholder="Search members and applications" autocomplete="off" ${on('input', 'topSearch', EL)}></div>
          <div class="dropdown-menu shadow-sm" id="searchres"></div></div>` : ''}
        <div class="ms-auto d-flex align-items-center gap-2">
          <a class="btn btn-light d-none d-md-inline-flex align-items-center gap-1" href="#/" title="Public website">${icon('globe')}<span class="small">Website</span></a>
          <div class="dropdown">
            <button class="btn btn-light d-flex align-items-center gap-2 py-1" data-bs-toggle="dropdown">
              <span class="avatar avatar-brand">${esc(user.init)}</span>
              <span class="text-start d-none d-sm-block lh-sm"><span class="d-block small fw-semibold">${esc(user.name)}</span><span class="small text-body-secondary">${esc(user.sub)}</span></span>
              ${icon('chevron-down', 'small text-body-secondary')}
            </button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
              ${admin ? `<li><span class="dropdown-item-text small text-body-secondary">${esc(session.email)}</span></li>` : `<li><a class="dropdown-item" href="#/app/profile">${icon('building', 'me-2')}Business profile</a></li>`}
              <li><a class="dropdown-item" href="#/">${icon('globe', 'me-2')}Public website</a></li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item text-danger" href="#" role="button" ${on('click', 'logout')}>${icon('box-arrow-right', 'me-2')}Sign out</a></li>
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
function topSearch(input) {
  const q = input.value;
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

expose({ topSearch, logout });

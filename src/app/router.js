import { Offcanvas } from 'bootstrap';
import { can } from '../core/auth/permissions.js';
import { ensureSession, getSession, setSession } from '../core/auth/session.js';
import { on } from '../core/events.js';
import { clearAfter, flushAfter, nav, setRenderer } from '../core/navigation.js';
import { announce, closeAllModals, esc, focusPage, icon } from '../shared/ui/index.js';
import { ADMIN_PAGES, ADMIN_PAGE_PERM, refreshNavCounts } from '../features/admin/index.js';
import { MEMBER_PAGES, refreshMember } from '../features/member/index.js';
import { PUBLIC, publicLayout, scrollPendingSection } from '../features/public/index.js';
import { appLayout } from './shell.js';

/* ================= ROUTER ================= */
const loading = () => `<div class="d-flex justify-content-center align-items-center py-5 min-vh-75"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading…</span></div></div>`;
const failed = e => `<section class="py-5 min-vh-75"><div class="container mw-640"><div class="card border-danger-subtle"><div class="card-body p-4 d-flex gap-3">
  <span class="icon-circle md bg-danger-subtle text-danger-emphasis">${icon(e?.code === 'NETWORK' ? 'wifi-off' : 'exclamation-octagon')}</span>
  <div><h2 class="h5 mb-1">This page couldn’t be loaded</h2><p class="small text-body-secondary mb-3">${esc(e?.message || 'Something went wrong.')}</p>
  <button class="btn btn-primary btn-sm" ${on('click', 'rerender')}>${icon('arrow-clockwise', 'me-1')}Try again</button></div></div></div></div></section>`;

let lastHash = null, renderSeq = 0;
async function route() {
  const seq = ++renderSeq;
  // Links in emails carry a query string, e.g. #/track/APP-2045?t=… or #/set-password?token=…
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  // A malformed escape (e.g. a stray "%") is kept as typed rather than throwing and blanking the page.
  const decode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const [a = '', b, c] = path.split('/').map(decode);
  const root = document.getElementById('root');
  const sameView = location.hash === lastHash;
  if (!sameView) { closeAllModals(); Offcanvas.getInstance(document.getElementById('sidebar'))?.hide(); }

  if (a === 'app') {
    let s = getSession();
    // Signed out (e.g. Back after signing out): a page only the console has means the staff sign-in page.
    const admin = s ? s.role === 'admin' : !!ADMIN_PAGES[b] && !MEMBER_PAGES[b];
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
  // A new page (not the first load, not a refresh in place): tell screen-reader users and start them at its heading.
  if (lastHash !== null && location.hash !== lastHash) { focusPage(root); announce(document.title); }
  lastHash = location.hash;
}

/** Starts routing: renders the current address now and again whenever it changes. */
export function start() {
  setRenderer(route);
  window.addEventListener('hashchange', route);
  route();
}

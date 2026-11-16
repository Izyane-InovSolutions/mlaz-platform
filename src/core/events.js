import { esc } from './html.js';

/* ================= EVENT HANDLERS ================= */
// The Content-Security-Policy forbids inline script, which includes onclick="…" attributes and javascript: URLs. Markup
// instead names a registered handler and its arguments (JSON data, never code), and one listener per event type on the
// document calls it:   `<button ${on('click', 'viewDoc', id, title)}>`   →   viewDoc(id, title)
// Pass EL to receive the element itself (a button to mark busy, a form to read). A submit never reloads the page, and a
// click on <a href="#"> never navigates.
const handlers = Object.create(null);
/** Registers functions that markup may name in on(). */
export const expose = o => { Object.assign(handlers, o); };
export const EL = Object.freeze({ $el: 1 });
export const on = (type, name, ...args) =>
  `data-on-${type}="${esc(name)}"${args.length ? ` data-args-${type}="${esc(JSON.stringify(args))}"` : ''}`;
for (const type of ['click', 'submit', 'input', 'change']) {
  document.addEventListener(type, e => {
    const el = e.target instanceof Element ? e.target.closest(`[data-on-${type}]`) : null;
    if (!el) return;
    if (type === 'submit' || (type === 'click' && el.matches('a[href="#"]'))) e.preventDefault();
    const fn = handlers[el.getAttribute(`data-on-${type}`)];
    if (typeof fn !== 'function') return;
    let args;
    try { args = JSON.parse(el.getAttribute(`data-args-${type}`) || '[]'); } catch (_) { return; }
    if (Array.isArray(args)) fn(...args.map(a => (a && a.$el === 1 ? el : a)));
  });
}

/** Runs a registered handler by name, for a helper that chooses between several (the console's search boxes). */
export const invoke = (name, ...args) => (typeof handlers[name] === 'function' ? handlers[name](...args) : undefined);

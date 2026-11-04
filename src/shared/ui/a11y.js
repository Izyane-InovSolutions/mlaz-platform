// Accessibility glue that applies to every page and dialog, wherever its markup was written.

const CONTROL = 'input:not([type=hidden]), select, textarea';
let seq = 0;

/**
 * Markup across the UI writes a field as `<label>Text</label><input name=…>` (or the control inside an .input-group
 * right after the label). Such a label is not tied to its control, so screen readers announce the field without a
 * name. This links each one: the control gets an id if it has none and the label gets `for`. Labels that already have
 * `for`, or wrap their control, are left alone; so is a label not followed by exactly one control.
 */
export function labelControls(root) {
  for (const label of root.querySelectorAll('label:not([for])')) {
    if (label.querySelector(CONTROL)) continue;
    const next = label.nextElementSibling;
    if (!next) continue;
    const controls = next.matches(CONTROL) ? [next] : [...next.querySelectorAll(CONTROL)];
    if (controls.length !== 1) continue;
    const control = controls[0];
    if (!control.id) control.id = `f${++seq}`;
    label.htmlFor = control.id;
  }
}

/** Keeps labels linked as pages, tables and dialogs are drawn. Call once at start-up. */
export function watchLabels() {
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; labelControls(document.body); });
  }).observe(document.body, { childList: true, subtree: true });
  labelControls(document.body);
}

/** Reads a short message out to screen-reader users without moving their focus (e.g. "Sign-in page"). */
export function announce(message) {
  const region = document.getElementById('announcer');
  if (!region) return;
  region.textContent = '';
  // A fresh text node after a tick, so the same message twice in a row is still read out.
  setTimeout(() => { region.textContent = message; }, 50);
}

/**
 * After moving to another page: put keyboard and screen-reader focus at the start of the new content (its first
 * heading), as a full page load would, instead of leaving it on the link that was activated.
 */
export function focusPage(root) {
  const main = root.querySelector('main');
  if (!main || document.querySelector('.modal.show')) return;
  const target = main.querySelector('h1, h2') || main;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

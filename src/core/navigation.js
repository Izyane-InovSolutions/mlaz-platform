// Routing glue: the router registers itself as the renderer; pages and handlers move with nav() and redraw the
// current view with rerender(). after() queues work for once the new markup is in the document.
import { expose } from './events.js';

let renderer = () => {};
export const setRenderer = f => { renderer = f; };
export const rerender = () => renderer();
export const nav = path => { const h = '#/' + path; if (location.hash === h) rerender(); else location.hash = h; };
const queue = [];
export const after = fn => queue.push(fn);
export const flushAfter = () => { while (queue.length) queue.shift()(); };
export const clearAfter = () => { queue.length = 0; };

expose({ nav, rerender });

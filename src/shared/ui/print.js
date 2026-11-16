import { esc, safeUrl } from './format.js';
import { toast } from './toast.js';

/*
 * Opens the markup in a new window with the app's styles and prints it, so it can be saved as PDF. The blank window
 * inherits this page's CSP, so it uses the same-origin stylesheets and the .print-doc body class, never inline styles.
 * <style> elements only exist under the dev server (Vite injects the CSS), whose policy allows them.
 */
export function printDoc(title, html) {
  const win = window.open('', '_blank');
  if (!win) return toast('Allow pop-ups to download the document', 'error');
  const styles = [...document.querySelectorAll('style')].map(s => s.outerHTML).join('')
    + [...document.querySelectorAll('link[rel=stylesheet]')].filter(l => safeUrl(l.href, 'self')).map(l => `<link rel="stylesheet" href="${esc(safeUrl(l.href, 'self'))}">`).join('');
  win.document.write(`<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>${styles}</head><body class="print-doc">${html}</body></html>`);
  win.document.close();
  win.onload = () => setTimeout(() => win.print(), 200);
}

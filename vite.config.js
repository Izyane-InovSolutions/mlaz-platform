import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

// The UI's Content-Security-Policy is defined once, in vercel.json (production). The dev server and `vite preview` send
// the same policy, so anything that needs inline script or inline styles breaks locally first. Only connection settings
// differ: the local API is plain http on another port, the dev server's hot reload uses a websocket, and violations are
// reported to it. One exception, for `vite dev` only: it injects the CSS as <style> elements, so its style-src also
// allows 'unsafe-inline'. `vite preview` serves the built bundle (CSS in files) with production's strict style-src.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
export const PROD_CSP = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;

export function localCsp(apiUrl, { devServer = false } = {}) {
  const api = new URL(apiUrl).origin;
  const csp = devServer ? PROD_CSP.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") : PROD_CSP;
  return csp
    .replace('connect-src ', `connect-src ${api} ws://localhost:* `)
    .replace('; upgrade-insecure-requests', '') // the local API has no https
    + `; report-uri ${api}/api/csp-report`;
}

// vercel.json cannot read environment variables, so its header allows `connect-src 'self' https:`. Every build adds a
// second policy as a <meta> tag that allows connections only to the UI's own origin and the API it was built for
// (VITE_API_URL). Browsers enforce every policy they receive, so the effective connect-src is that one origin. The
// header keeps the directives a <meta> policy cannot carry (frame-ancestors, report-uri).
export function connectSrcPolicy(apiUrl) {
  return `connect-src 'self' ${new URL(apiUrl).origin}`;
}

/** The API a build talks to. A Vercel production build must name an https API, never fall back to localhost. */
export function buildApiUrl(env, vercelEnv = process.env.VERCEL_ENV) {
  const url = env.VITE_API_URL;
  if (vercelEnv === 'production' && !/^https:\/\/[^/]+/.test(url ?? '')) {
    throw new Error('VITE_API_URL must be set to the https:// address of the API for a production build (Vercel project settings, Production environment).');
  }
  return url || 'http://localhost:3000/api';
}

const connectSrcMeta = api => ({
  name: 'mlaz-connect-src',
  apply: 'build', // the dev server's own policy (below) also allows its hot-reload websocket
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: connectSrcPolicy(api) }, injectTo: 'head-prepend' }],
});

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const api = command === 'build' ? buildApiUrl(env) : env.VITE_API_URL || 'http://localhost:3000/api';
  return {
    plugins: [connectSrcMeta(api)],
    server: { headers: { 'Content-Security-Policy': localCsp(api, { devServer: true }) } },
    preview: { headers: { 'Content-Security-Policy': localCsp(api) } },
    css: {
      preprocessorOptions: {
        scss: {
          // Bootstrap 5.3's SCSS still uses @import and legacy colour functions.
          quietDeps: true,
          silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'mixed-decls'],
        },
      },
    },
  };
});

import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

// The UI's Content-Security-Policy is defined once, in vercel.json (production). The dev server and `vite preview` send
// the same policy, so anything that needs inline script breaks locally first. Only connection settings differ: the local
// API is plain http on another port, the dev server's hot reload uses a websocket, and violations are reported to it.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
export const PROD_CSP = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;

export function localCsp(apiUrl) {
  const api = new URL(apiUrl).origin;
  return PROD_CSP
    .replace('connect-src ', `connect-src ${api} ws://localhost:* `)
    .replace('; upgrade-insecure-requests', '') // the local API has no https
    + `; report-uri ${api}/api/csp-report`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const headers = { 'Content-Security-Policy': localCsp(env.VITE_API_URL || 'http://localhost:3000/api') };
  return {
    server: { headers },
    preview: { headers },
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

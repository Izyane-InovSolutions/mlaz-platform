// Regression tests for the UI's Content-Security-Policy (Phase 3, R4). Run with `npm test` (node --test), after
// `npm run build` so the built bundle is checked too. Browser behaviour is verified separately (see server/README.md).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { PROD_CSP, localCsp } from '../vite.config.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SRC = readdirSync(new URL('../src', import.meta.url)).filter(f => f.endsWith('.js')).map(f => [`src/${f}`, read(`src/${f}`)]);
const directives = csp => Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([k, ...v]) => [k, v]));
// Comments may describe what is forbidden; only code counts.
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function assertStrictScripts(csp, label) {
  const d = directives(csp);
  assert.deepEqual(d['script-src'], ["'self'"], `${label}: script-src must be exactly 'self'`);
  assert.deepEqual(d['script-src-attr'], ["'none'"], `${label}: inline event handlers must be blocked`);
  for (const [k, v] of Object.entries(d)) {
    if (k.startsWith('script-src') || k === 'default-src') {
      for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'", 'data:', 'blob:', '*', 'https:', 'http:']) {
        assert.ok(!v.includes(bad), `${label}: ${k} must not allow ${bad}`);
      }
    }
  }
  assert.deepEqual(d['object-src'], ["'none'"], `${label}: object-src`);
  assert.deepEqual(d['base-uri'], ["'none'"], `${label}: base-uri`);
  assert.deepEqual(d['frame-ancestors'], ["'none'"], `${label}: frame-ancestors`);
}

test('production policy (vercel.json) forbids inline and injected script on every path', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find(h => h.headers.some(x => x.key === 'Content-Security-Policy'));
  assert.equal(rule.source, '/(.*)', 'the CSP must cover every path');
  assert.ok(!vercel.headers.some(h => h.headers.some(x => x.key === 'Content-Security-Policy-Report-Only')), 'no report-only policy should replace the enforced one');
  assertStrictScripts(PROD_CSP, 'production');
  assert.ok(directives(PROD_CSP)['upgrade-insecure-requests'], 'production upgrades insecure requests');
});

test('development and preview servers send the same script rules (no weaker dev policy)', () => {
  const dev = localCsp('http://localhost:3000/api');
  assertStrictScripts(dev, 'dev/preview');
  for (const k of Object.keys(directives(PROD_CSP))) {
    if (k === 'connect-src' || k === 'upgrade-insecure-requests') continue;
    assert.deepEqual(directives(dev)[k], directives(PROD_CSP)[k], `dev/preview ${k} must match production`);
  }
  assert.match(dev, /report-uri http:\/\/localhost:3000\/api\/csp-report/);
});

test('no inline event handlers, javascript: URLs or eval-like calls in the UI source', () => {
  for (const [file, text] of [...SRC, ['index.html', read('index.html')]]) {
    const c = code(text);
    assert.doesNotMatch(c, /\son[a-z]+\s*=\s*["'`\\]/i, `${file}: inline event handler attribute`);
    assert.doesNotMatch(c, /javascript:/i, `${file}: javascript: URL`);
    assert.doesNotMatch(c, /\beval\s*\(|new\s+Function\s*\(|set(Timeout|Interval)\(\s*['"`]/, `${file}: string evaluated as code`);
    assert.doesNotMatch(c, /<script(?![^>]*\bsrc=)[^>]*>/i, `${file}: inline <script>`);
  }
});

test('every handler named in markup is registered, so legitimate UI actions still work', () => {
  const all = SRC.map(([, t]) => code(t)).join('\n');
  const used = new Set();
  const add = re => { for (const m of all.matchAll(re)) used.add(m[1]); };
  add(/\bon\('(?:click|submit|input|change)', '(\w+)'/g); // on('click', 'name', …)
  add(/data-on-(?:click|submit|input|change)="(\w+)"/g); // literal attributes in quoted strings
  add(/\b(?:pager|pills|searchBox)\([^;]*?'(set\w+)'/g); // helpers handed a setter name
  add(/=> \['(\w+)'/g); // ATTENTION actions in admin.js
  add(/editBtn\(\['(\w+)'/g);
  const registered = new Set();
  for (const m of all.matchAll(/expose\(\{([^}]*)\}\)/g)) for (const n of m[1].match(/\w+/g)) registered.add(n);
  assert.ok(used.size > 80, `found only ${used.size} handler references; the scan is broken`);
  const missing = [...used].filter(n => !registered.has(n));
  assert.deepEqual(missing, [], `handlers used in markup but never registered: ${missing.join(', ')}`);
});

test('the delegated dispatcher runs registered functions only, with JSON data as arguments', () => {
  const ui = read('src/ui.js');
  assert.match(ui, /const handlers = Object\.create\(null\)/, 'registry has no prototype (no __proto__/constructor gadgets)');
  assert.match(ui, /JSON\.parse\(el\.getAttribute\(`data-args-\$\{type\}`\)/, 'arguments are parsed as JSON, never evaluated');
  assert.doesNotMatch(code(ui), /Object\.assign\(window/, 'handlers are not published as globals');
});

test('the built bundle contains no inline script and no eval', { skip: !existsSync(new URL('../dist/index.html', import.meta.url)) && 'run npm run build first' }, () => {
  const html = read('dist/index.html');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'dist/index.html has an inline <script>');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'dist/index.html has an inline handler');
  const assets = readdirSync(new URL('../dist/assets', import.meta.url)).filter(f => f.endsWith('.js'));
  assert.ok(assets.length > 0);
  for (const f of assets) {
    const js = read(`dist/assets/${f}`);
    assert.doesNotMatch(js, /\bonclick="|\boninput="|\bonsubmit="|\bonchange="/, `${f}: inline handler in generated markup`);
    assert.doesNotMatch(js, /javascript:void/, `${f}: javascript: URL`);
    assert.doesNotMatch(js, /new Function\(|\beval\(/, `${f}: eval-like call (would need 'unsafe-eval')`);
  }
});

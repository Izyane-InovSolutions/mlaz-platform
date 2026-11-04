// Keeps the UI's layering (docs/frontend-architecture.md) true by reading the import lines of every module in src/.
// Layers, lowest first: core/ (no markup) -> shared/ui (business-independent markup) -> features/ -> app/ -> main.js.
// Run with `npm test` (node --test); no browser or build needed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const SRC = new URL('../src/', import.meta.url);
const FILES = readdirSync(SRC, { recursive: true }).map(f => f.replaceAll('\\', '/')).filter(f => f.endsWith('.js')).sort();
const TEXT = Object.fromEntries(FILES.map(f => [f, readFileSync(new URL(f, SRC), 'utf8')]));
// Comments may name what is forbidden; only code counts.
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every import of every module: { from, spec, to } with `to` resolved (relative to src/) for relative specifiers. */
const IMPORTS = FILES.flatMap(from => {
  const c = code(TEXT[from]);
  const specs = [
    ...[...c.matchAll(/^\s*(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm)].map(m => m[1]),
    ...[...c.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map(m => m[1]), // side-effect imports
  ];
  return specs.map(spec => ({ from, spec, to: spec.startsWith('.') ? path.posix.join(path.posix.dirname(from), spec) : null }));
});
const local = IMPORTS.filter(i => i.to);
const under = (file, dir) => file.startsWith(`${dir}/`);
const list = xs => xs.map(i => `${i.from} imports ${i.spec}`);

// A feature is features/<name>/ (common, account), or a page or shared folder inside an area: features/<area>/<page>/.
// Files directly in an area folder (features/admin/index.js, the area's page registry) belong to the area itself.
const AREAS = ['public', 'member', 'admin'];
function featureOf(file) {
  const p = file.split('/');
  if (p[0] !== 'features') return null;
  return AREAS.includes(p[1]) && p.length >= 4 ? `${p[1]}/${p[2]}` : p[1];
}
/**
 * The rule for features: a file may import
 *  - anything in its own feature folder;
 *  - its own area's shared folder (features/admin/members/* may use features/admin/shared/*);
 *  - another feature only through that feature's index.js, its public interface; never its internal files.
 * The same index-only rule applies to app/ and main.js.
 */
function reachable(from, to) {
  const target = featureOf(to);
  if (!target) return true;
  if (featureOf(from) === target) return true;
  const area = to.split('/')[1];
  if (AREAS.includes(area) && under(to, `features/${area}/shared`) && under(from, `features/${area}`)) return true;
  return to === `features/${target}/index.js`;
}

test('the scan finds the imports it checks (guards against silently matching nothing)', () => {
  assert.ok(FILES.length > 40, `only ${FILES.length} modules found`);
  assert.ok(local.length > 200, `only ${local.length} relative imports found`);
  assert.ok(local.filter(i => under(i.from, 'features')).length > 100, 'too few feature imports found');
});

test('every relative import resolves to a module that exists', () => {
  assert.deepEqual(local.filter(i => !existsSync(new URL(i.to, SRC))).map(i => `${i.from}: ${i.spec} does not exist`), []);
});

/** Names a module exports, following `export * from` re-exports. */
function exportsOf(file, seen = new Set()) {
  if (seen.has(file) || !TEXT[file]) return new Set();
  seen.add(file);
  const c = code(TEXT[file]), names = new Set();
  for (const m of c.matchAll(/^\s*export (async function|function|const|let|class) (\w+)/gm)) names.add(m[2]);
  for (const m of c.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) for (const n of m[1].split(',')) if (n.trim()) names.add(n.trim().split(/\s+as\s+/).pop());
  for (const m of c.matchAll(/^\s*export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) {
    for (const n of exportsOf(path.posix.join(path.posix.dirname(file), m[1]), seen)) names.add(n);
  }
  return names;
}

test('every named import is exported by the module it names', () => {
  const missing = FILES.flatMap(from => [...code(TEXT[from]).matchAll(/^\s*(?:import|export)\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/gm)].flatMap(([, names, spec]) => {
    const to = path.posix.join(path.posix.dirname(from), spec), exported = exportsOf(to);
    return names.split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(n => n && !exported.has(n)).map(n => `${from}: ${n} is not exported by ${spec}`);
  }));
  assert.deepEqual(missing, []);
});

test('core/ is the bottom layer: it never imports shared/, features/ or app/', () => {
  assert.deepEqual(list(local.filter(i => under(i.from, 'core') && ['shared', 'features', 'app'].some(d => under(i.to, d)))), []);
});

test('shared/ stays business-independent: no features/, app/, session or API access', () => {
  const banned = ['features', 'app', 'core/auth', 'core/api'];
  assert.deepEqual(list(local.filter(i => under(i.from, 'shared') && banned.some(d => under(i.to, d)))), []);
});

test('features never import app/ (the router and shell sit above them)', () => {
  assert.deepEqual(list(local.filter(i => under(i.from, 'features') && under(i.to, 'app'))), []);
});

test('a feature is reached only through its index.js, never through its internal files', () => {
  assert.deepEqual(list(local.filter(i => !reachable(i.from, i.to))), []);
});

test('fetch() is called only by the API client (core/api/client.js)', () => {
  const callers = FILES.filter(f => /\bfetch\s*\(/.test(code(TEXT[f])));
  assert.deepEqual(callers, ['core/api/client.js']);
});

test('each event handler name is registered by one module only (a second expose() would silently replace the first)', () => {
  const owners = {};
  for (const f of FILES) for (const m of code(TEXT[f]).matchAll(/expose\(\{([^}]*)\}\)/g)) for (const n of m[1].match(/\w+/g)) (owners[n] ||= []).push(f);
  assert.ok(Object.keys(owners).length > 80, 'too few handlers found');
  assert.deepEqual(Object.entries(owners).filter(([, fs]) => fs.length > 1).map(([n, fs]) => `${n}: ${fs.join(', ')}`), []);
});

test('there are no import cycles', () => {
  const graph = Object.fromEntries(FILES.map(f => [f, local.filter(i => i.from === f && TEXT[i.to]).map(i => i.to)]));
  const state = {}, cycles = [];
  const visit = (f, trail) => {
    if (state[f] === 'done') return;
    if (state[f] === 'open') { cycles.push([...trail.slice(trail.indexOf(f)), f].join(' -> ')); return; }
    state[f] = 'open';
    for (const next of graph[f]) visit(next, [...trail, f]);
    state[f] = 'done';
  };
  for (const f of FILES) visit(f, []);
  assert.deepEqual(cycles, []);
});

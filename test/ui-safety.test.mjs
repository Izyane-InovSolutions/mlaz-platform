// Regression tests for the UI's markup safety (DOM XSS / HTML injection): esc(), safeUrl() and safeFilename(), the
// shared helpers that put values into class names, the delegated event dispatcher, and static scans of src/ for the
// patterns fixed in the review (unchecked URLs, inline styles, unescaped error messages, handler names from data).
// Run with `npm test` (node --test). See docs/frontend-architecture.md, "Markup and escaping".
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { esc, safeFilename, safeUrl } from '../src/core/html.js';
import { avatar, icon, pctClass } from '../src/shared/ui/components.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SRC = readdirSync(new URL('../src', import.meta.url), { recursive: true }).map(f => f.replaceAll('\\', '/'))
  .filter(f => f.endsWith('.js')).sort().map(f => [`src/${f}`, read(`src/${f}`)]);
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ALL = SRC.map(([f, t]) => [f, code(t)]);
const ch = n => String.fromCharCode(n);

test('the scan sees the whole UI', () => {
  assert.ok(SRC.length > 40 && SRC.some(([f]) => f.startsWith('src/features/admin/')), `scanned only ${SRC.length} files`);
});

/* ---------------- pure functions ---------------- */

test('esc() escapes every character that can end a text node or an attribute', () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(esc(null), ''); assert.equal(esc(undefined), ''); assert.equal(esc(0), '0');
  assert.equal(esc('&amp;'), '&amp;amp;', 'esc is not idempotent: escape once, at the point of output');
});

test('safeUrl() allows https, same-origin, own blob: and PNG data URLs only', () => {
  const js = 'java' + 'script:'; // spelled in two parts so the linter's no-script-url doesn't flag the test data
  const bad = [`${js}alert(1)`, 'JaVa' + 'ScRiPt:alert(1)', ` ${js}alert(1)`, `java${ch(10)}script:alert(1)`, `java${ch(9)}script:x`,
    `${ch(0)}${js}x`,'vbscript:x', 'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,AAA"onerror=x', 'http://example.com/', '//evil.example/', '/\\evil.example', '\\\\evil.example',
    'https:evil.example', 'https:/evil.example', 'https:\\\\evil.example', 'blob:https://evil.example/1', 'blob:null/1', '', null, undefined, 42, {}];
  for (const u of bad) assert.equal(safeUrl(u), '', `must reject ${JSON.stringify(u)}`);
  for (const u of ['https://pay.example/checkout?x=1', 'HTTPS://pay.example/', '#/app/members/MLA-1', '/assets/app.css', 'data:image/png;base64,iVBORw0KGgo=']) {
    assert.equal(safeUrl(u), u, `must allow ${u}`);
  }
});

test('safeUrl() kinds narrow what is allowed: checkoutUrl takes https only', () => {
  for (const u of ['#/app', '/x', 'data:image/png;base64,iVBORw0KGgo=']) assert.equal(safeUrl(u, 'https'), '', `${u} is not https`);
  assert.equal(safeUrl('https://pay.example/', 'self blob png'), '');
  assert.equal(safeUrl('https://pay.example/', 'https'), 'https://pay.example/');
  assert.equal(safeUrl('#/app', 'https'), '');
});

test('safeUrl() accepts blob: and absolute URLs of this page\'s own origin only', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://mlaz.example' }, configurable: true });
  try {
    assert.equal(safeUrl('blob:https://mlaz.example/0d0f-1'), 'blob:https://mlaz.example/0d0f-1');
    assert.equal(safeUrl('blob:https://mlaz.example.evil/1'), '');
    assert.equal(safeUrl('https://mlaz.example/assets/a.css', 'self'), 'https://mlaz.example/assets/a.css');
    assert.equal(safeUrl('https://mlaz.example.evil/a.css', 'self'), '');
    assert.equal(safeUrl('blob:https://mlaz.example/1', 'https'), '');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'location', saved); else delete globalThis.location;
  }
});

test('safeFilename() strips path separators, control characters and leading dots', () => {
  assert.equal(safeFilename('../../etc/passwd'), '_.._etc_passwd');
  assert.ok(!/[/\\]/.test(safeFilename('..\\..\\boot.ini')));
  assert.equal(safeFilename(`a${ch(0)}b${ch(10)}.pdf`), 'a_b_.pdf');
  assert.equal(safeFilename('..'), 'download');
  assert.equal(safeFilename(undefined, 'document'), 'document');
  assert.equal(safeFilename('receipt PAY-1.pdf'), 'receipt PAY-1.pdf');
  assert.ok(safeFilename('x'.repeat(500)).length <= 120);
});

test('class-name helpers cannot be broken out of with data from the API', () => {
  assert.equal(icon('x" onmouseover="alert(1)'), '<i class="bi bi-xonmouseoveralert1 " aria-hidden="true"></i>');
  assert.equal(pctClass(150), 'pct-100'); assert.equal(pctClass(-5), 'pct-0'); assert.equal(pctClass('"><b>'), 'pct-0'); assert.equal(pctClass(33.4), 'pct-33');
  const a = avatar('<b>x</b>', '"><script>');
  assert.doesNotMatch(a, /<script|<b>|style=/);
  assert.match(avatar('Ann Lee', 9), /class="avatar ava-1 /);
});

/* ---------------- the event dispatcher ---------------- */

test('the dispatcher only runs registered handlers, with JSON arguments, for any attribute value', async () => {
  const listeners = {};
  globalThis.Element = class {};
  globalThis.document = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const { expose, on, EL } = await import('../src/core/events.js');
  const calls = [];
  expose({ probe: (...a) => calls.push(a) });
  const fire = (name, args) => {
    const el = Object.assign(new globalThis.Element(), {
      closest: () => el, matches: () => false,
      getAttribute: k => (k === 'data-on-click' ? name : k === 'data-args-click' ? args : null),
    });
    listeners.click({ target: el, preventDefault() {} });
    return el;
  };
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'alert', 'eval', '', null]) fire(name, '[]');
  assert.equal(calls.length, 0, 'names that are not registered (including prototype names) do nothing');
  fire('probe', 'alert(1)'); fire('probe', '{"a":1}'); fire('probe', '"x"');
  assert.equal(calls.length, 0, 'arguments that are not a JSON array are ignored, never evaluated');
  const el = fire('probe', JSON.stringify([1, 'two', { $el: 1 }]));
  assert.deepEqual(calls, [[1, 'two', el]]);
  // Markup built with on() is escaped: a quote in an argument can't add an attribute.
  assert.doesNotMatch(on('click', 'probe', '" data-on-click="logout'), /" data-on-click="logout/);
  assert.equal(EL.$el, 1);
});

test('handler names in markup come from this source code, never from data', () => {
  // on('type', name, …): the name is a string literal, or one of these helper parameters whose callers pass literals.
  const PARAMS = new Set(['fn', '...handler', '...go(a.target']); // the capture stops at the first ')'
  for (const [f, c] of ALL) {
    for (const m of c.matchAll(/\bon\('(?:click|submit|input|change)', ([^,)]+)/g)) {
      assert.ok(/^'\w+'$/.test(m[1].trim()) || PARAMS.has(m[1].trim()), `${f}: handler name ${m[1]} is not a literal`);
    }
  }
  const dash = ALL.find(([f]) => f.endsWith('admin/dashboard/dashboard.js'))[1];
  for (const m of dash.matchAll(/t => \[([^,\]]+)/g)) assert.match(m[1], /^'\w+'$/, 'ATTENTION actions name literal handlers');
  const settings = ALL.find(([f]) => f.endsWith('admin/settings/settings.js'))[1];
  for (const m of settings.matchAll(/editBtn\(\[([^,\]]+)/g)) assert.match(m[1], /^'\w+'$/, 'editBtn names literal handlers');
  // calls (not the definitions) of the helpers that take a setter name: the rest of the line names a literal setter
  for (const m of ALL.flatMap(([, c]) => [...c.matchAll(/\b(?:pager|pills|searchBox)\((?!r, fn\)|items, active, fn\)|value, fn, ph\))[^\n]*/g)])) {
    assert.match(m[0], /'set\w+'/, `pager/pills/searchBox take a literal setter: ${m[0]}`);
  }
  for (const [f, c] of ALL) for (const m of c.matchAll(/\binvoke\(([^,)]+)/g)) {
    assert.ok(f.endsWith('core/events.js') || /SEARCH_SETTERS\.includes\(fn\)\) invoke\(fn/.test(c), `${f}: invoke(${m[1]}) without an allowlist`);
  }
});

/* ---------------- static scans ---------------- */

test('no inline style attributes or <style> elements in markup (style-src has no unsafe-inline)', () => {
  for (const [f, c] of [...ALL, ['index.html', read('index.html')]]) {
    assert.doesNotMatch(c, /\sstyle\s*=\s*["'`\\$]/i, `${f}: style attribute; use a class in src/styles/styles.scss`);
    assert.doesNotMatch(c, /<style[\s>]/i, `${f}: <style> element`);
    assert.doesNotMatch(c, /setAttribute\(\s*['"]style['"]|\.style\.cssText\s*=/, `${f}: style attribute set from script`);
  }
  const scss = read('src/styles/styles.scss');
  for (const cls of ['@for $i from 0 through 100', '.ava-#{', '.print-doc', '.z-toast', '.icon-circle']) assert.ok(scss.includes(cls), `styles.scss defines ${cls}`);
});

test('every URL interpolated into href or src goes through safeUrl (or is a #/ route built with encoding)', () => {
  // Reads each href="…"/src="…" value, keeping ${…} interpolations (which may contain quotes and braces) whole.
  function* attrs(c) {
    for (const start of c.matchAll(/\b(href|src)="/g)) {
      let i = start.index + start[0].length, depth = 0, cur = '', value = '';
      const parts = [];
      for (; i < c.length; i++) {
        if (depth === 0 && c[i] === '"') break;
        if (depth === 0 && c.startsWith('${', i)) { depth = 1; i++; value += '${'; continue; }
        if (depth > 0) {
          if (c[i] === '{') depth++;
          if (c[i] === '}' && --depth === 0) { parts.push(cur.trim()); cur = ''; value += '}'; continue; }
          cur += c[i];
        }
        value += c[i];
      }
      yield [start[1], value, parts];
    }
  }
  let n = 0;
  for (const [f, c] of ALL) {
    for (const [name, value, parts] of attrs(c)) {
      const m = [null, name, value];
      if (!parts.length) continue;
      n++;
      if (m[2].startsWith('${')) {
        assert.ok(m[2] === `\${${parts[0]}}` && /^esc\(safeUrl\(/.test(parts[0]), `${f}: ${m[1]}="${m[2]}" must be \${esc(safeUrl(…))}`);
      } else {
        assert.match(m[2], /^#\//, `${f}: ${m[1]}="${m[2]}" interpolates into a non-route URL`);
        for (const p of parts) {
          assert.ok(/^(esc|encodeURIComponent)\(/.test(p) || /^[\w.\s=!']+\?\s*'[\w-]*'\s*:\s*'[\w-]*'$/.test(p), `${f}: ${m[1]}="${m[2]}": \${${p}} is not encoded`);
        }
      }
    }
  }
  assert.ok(n > 20, `found only ${n} interpolated URLs; the scan is broken`);
});

test('gateway checkout URLs are https only, wherever they are used', () => {
  for (const [f, c] of ALL) {
    for (const line of c.split('\n').filter(l => l.includes('checkoutUrl'))) {
      // every occurrence is the first argument of safeUrl(…, 'https')
      for (let i = line.indexOf('checkoutUrl'); i >= 0; i = line.indexOf('checkoutUrl', i + 1)) {
        const before = line.slice(0, i).replace(/[\w?.]+$/, '');
        assert.ok(before.endsWith('safeUrl(') && line.startsWith("checkoutUrl, 'https')", i), `${f}: checkoutUrl used without safeUrl(…, 'https'): ${line.trim()}`);
      }
    }
  }
});

test('error messages and download names are escaped or sanitised before they reach markup', () => {
  for (const [f, c] of ALL) {
    assert.doesNotMatch(c, /\$\{\s*(?:e|err|ex|error)\??\.message\s*\}/, `${f}: an API error message interpolated without esc()`);
    assert.doesNotMatch(c, /\$\{\s*(?:url|qr|href|src)\s*\}/, `${f}: a bare URL variable interpolated into markup`);
    if (/content-disposition/.test(c)) assert.match(c, /safeFilename\(\/filename=/, `${f}: a filename from content-disposition is used unsanitised`);
    for (const line of c.split('\n').filter(l => /\.(src|href)\s*=[^=]|\bhref: /.test(l))) {
      // the one exception: download() links the object URL it has just created itself
      assert.ok(/safeUrl\(/.test(line) || /\{ href: url, download: name \}/.test(line), `${f}: an element src/href set without safeUrl(): ${line.trim()}`);
    }
    assert.doesNotMatch(c, /window\.open\(\s*(?!'',)/, `${f}: window.open with a URL (only printDoc's blank window is allowed)`);
  }
});

test('document previews only render the types the server accepts', () => {
  const docs = ALL.find(([f]) => f.endsWith('common/documents.js'))[1];
  assert.match(docs, /const PREVIEW = \['application\/pdf', 'image\/jpeg', 'image\/png'\]/);
  assert.match(docs, /new Blob\(\[blob\], \{ type \}\)/, 'documents are re-typed before an object URL is made');
  for (const [f, c] of ALL) if (!f.endsWith('common/documents.js')) assert.doesNotMatch(c, /blob\.type\.startsWith/, `${f}: previews a blob by its own type; use documentPreview()`);
});

test('printDoc writes no inline style and copies only same-origin stylesheets', () => {
  const p = ALL.find(([f]) => f.endsWith('shared/ui/print.js'))[1];
  assert.match(p, /safeUrl\(l\.href, 'self'\)/);
  assert.match(p, /<body class="print-doc">/);
});

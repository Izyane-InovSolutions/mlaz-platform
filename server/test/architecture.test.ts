// Keeps the module boundaries in docs/architecture.md true. Reads the import statements and database writes of every
// source file; needs no database. Each rule lists the offending imports, so a failure says exactly what to move.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');
const rel = (p: string) => path.relative(SRC, p).replaceAll(path.sep, '/');
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = path.join(dir, f);
  if (statSync(p).isDirectory()) return f === 'generated' ? [] : files(p);
  return p.endsWith('.ts') ? [p] : [];
});
const SOURCES = files(SRC).map(p => ({ file: rel(p), text: readFileSync(p, 'utf8') }));

/** Where a file sits: its module and layer, or the shared kernel, the platform, config or the entry point. */
function place(file: string) {
  const parts = file.split('/');
  if (parts[0] === 'modules') {
    const layer = parts.length > 3 ? parts[2] : parts[2].replace(/\.ts$/, ''); // domain | application | ... | index | http | module
    return { area: 'modules', module: parts[1], layer };
  }
  return { area: parts.length > 1 ? parts[0] : parts[0].replace(/\.ts$/, ''), module: null, layer: null };
}

interface Import { from: string; to: string; spec: string; typeOnly: boolean }
// eslint-disable-next-line security/detect-unsafe-regex -- runs only over this repository's own source files
const IMPORT = /^\s*(import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?'([^']+)'|\bimport\(\s*'([^']+)'\s*\)/gm;
const imports: Import[] = SOURCES.flatMap(({ file, text }) => [...text.matchAll(IMPORT)].map(m => {
  const spec = m[3] ?? m[4];
  const to = spec.startsWith('.') ? rel(path.resolve(SRC, path.dirname(file), spec.replace(/\.js$/, '.ts'))) : spec;
  return { from: file, to, spec, typeOnly: !!m[2] };
}));
const show = (list: Import[]) => list.map(i => `${i.from} imports ${i.spec}`);
const local = imports.filter(i => i.spec.startsWith('.'));

const MODULES = ['identity', 'membership', 'applications', 'payments', 'finance', 'lending', 'events', 'communications', 'documents', 'reporting', 'administration', 'audit'];

describe('architecture: the scan', () => {
  it('finds the files and imports it checks (guards against matching nothing)', () => {
    expect(SOURCES.length).toBeGreaterThan(80);
    expect(local.length).toBeGreaterThan(400);
    expect(imports.filter(i => i.typeOnly).length).toBeGreaterThan(10);
  });

  it('every relative import resolves to a source file', () => {
    expect(local.filter(i => !existsSync(path.join(SRC, i.to))).map(i => `${i.from}: ${i.spec}`)).toEqual([]);
  });

  it('has the business modules, each with a public interface and a registration', () => {
    const found = readdirSync(path.join(SRC, 'modules')).sort();
    expect(found).toEqual([...MODULES].sort());
    for (const m of MODULES) {
      expect(existsSync(path.join(SRC, 'modules', m, 'index.ts')), `${m}/index.ts`).toBe(true);
      expect(existsSync(path.join(SRC, 'modules', m, 'module.ts')), `${m}/module.ts`).toBe(true);
    }
  });
});

describe('architecture: layers inside a module', () => {
  const inLayer = (layer: string) => imports.filter(i => place(i.from).layer === layer);

  it('domain is pure: no HTTP, no database client or generated Prisma code, no config, no other layer, no other module', () => {
    const allowedShared = new Set(['shared/dates.ts', 'shared/money.ts', 'shared/errors.ts', 'shared/tokens.ts', 'shared/actor.ts']);
    const bad = inLayer('domain').filter(i => {
      const from = place(i.from), to = place(i.to);
      if (!i.spec.startsWith('.')) return !['zod'].includes(i.spec) && !i.spec.startsWith('node:');
      if (to.area === 'shared') return !allowedShared.has(i.to);
      return !(to.module === from.module && to.layer === 'domain');
    });
    expect(show(bad)).toEqual([]);
  });

  it('application never depends on HTTP: no fastify, no presentation layer, no module http.ts', () => {
    const bad = inLayer('application').filter(i => i.spec === 'fastify' || i.spec.startsWith('@fastify/') || place(i.to).layer === 'presentation'
      || place(i.to).layer === 'http' || i.to === 'shared/http.ts');
    expect(show(bad)).toEqual([]);
  });

  it('infrastructure implements adapters: no HTTP, no presentation, and only types from the application layer', () => {
    const bad = inLayer('infrastructure').filter(i => i.spec === 'fastify' || place(i.to).layer === 'presentation' || (place(i.to).layer === 'application' && !i.typeOnly));
    expect(show(bad)).toEqual([]);
  });

  it('presentation (routes) holds no business logic: no database client, no infrastructure, no generated Prisma values', () => {
    const bad = inLayer('presentation').filter(i => i.to === 'shared/db.ts' || place(i.to).layer === 'infrastructure'
      || (i.to.startsWith('generated/') && !i.typeOnly));
    expect(show(bad)).toEqual([]);
  });

  // Paths built from request data are confined by the documents module (storage keys, temporary upload files); no
  // other code touches the file system, so a path trick in a file name cannot reach it ("ignores path tricks" test).
  it('only the documents module touches the file system', () => {
    const bad = imports.filter(i => /^(node:)?fs(\/promises)?$/.test(i.spec) && !/^modules\/documents\/(infrastructure|presentation)\//.test(i.from));
    expect(show(bad)).toEqual([]);
  });

  it('only the presentation layer and the platform use the HTTP helpers', () => {
    const bad = imports.filter(i => i.to === 'shared/http.ts' && !['presentation'].includes(place(i.from).layer ?? '') && place(i.from).area !== 'platform');
    expect(show(bad)).toEqual([]);
  });
});

describe('architecture: modules talk through public interfaces', () => {
  it('another module is reached only through its index.ts (application) or http.ts (presentation)', () => {
    const bad = local.filter(i => {
      const from = place(i.from), to = place(i.to);
      if (to.area !== 'modules' || from.module === to.module) return false;
      if (from.area === 'platform') return !['index', 'http', 'module'].includes(to.layer!);
      if (to.layer === 'index') return false;
      return !(to.layer === 'http' && from.layer === 'presentation');
    });
    expect(show(bad)).toEqual([]);
  });

  // A public interface offers only what other code uses, so it cannot quietly grow into a second way in.
  it('everything a module exports from index.ts is used outside the module', () => {
    const outside = (m: string) => SOURCES.filter(s => place(s.file).module !== m).map(s => s.text).join('\n')
      + files(path.resolve(SRC, '../test')).map(p => readFileSync(p, 'utf8')).join('\n');
    const unused = MODULES.flatMap(m => {
      const index = readFileSync(path.join(SRC, 'modules', m, 'index.ts'), 'utf8');
      const names = [
        ...[...index.matchAll(/export \{([^}]*)\}/g)].flatMap(x => x[1].split(',').map(n => n.replace(/^\s*type\s+/, '').trim()).filter(Boolean)),
        ...[...index.matchAll(/^export (?:async )?(?:const|let|function|class|interface|type|enum) (\w+)/gm)].map(x => x[1]),
      ];
      const text = outside(m);
      return names.filter(n => !new RegExp(`\\b${n}\\b`).test(text)).map(n => `${m}/index.ts exports ${n}`);
    });
    expect(unused).toEqual([]);
  });

  it('a module.ts (route registration) is imported only by the platform', () => {
    expect(show(local.filter(i => place(i.to).layer === 'module' && place(i.from).area !== 'platform'))).toEqual([]);
  });

  it('the shared kernel depends on no module and not on the platform', () => {
    expect(show(local.filter(i => place(i.from).area === 'shared' && ['modules', 'platform'].includes(place(i.to).area)))).toEqual([]);
  });

  it('modules never import the platform (it is the composition root, above them all)', () => {
    expect(show(local.filter(i => place(i.from).area === 'modules' && place(i.to).area === 'platform'))).toEqual([]);
  });
});

/** Strongly connected components of size > 1 (or self loops) in a graph: the cycles. */
function cycles(edges: Map<string, Set<string>>) {
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], on = new Set<string>(), out: string[][] = [];
  let n = 0;
  const visit = (v: string) => {
    index.set(v, n); low.set(v, n++); stack.push(v); on.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const c: string[] = [];
      let w: string;
      do { w = stack.pop()!; on.delete(w); c.push(w); } while (w !== v);
      if (c.length > 1 || edges.get(v)?.has(v)) out.push(c.sort());
    }
  };
  for (const v of edges.keys()) if (!index.has(v)) visit(v);
  return out;
}
const graph = (pairs: [string, string][]) => {
  const g = new Map<string, Set<string>>();
  for (const [a, b] of pairs) { if (!g.has(a)) g.set(a, new Set()); g.get(a)!.add(b); if (!g.has(b)) g.set(b, new Set()); }
  return g;
};

describe('architecture: no circular dependencies', () => {
  // Type-only imports are erased at build time, so they cannot form a runtime cycle.
  const runtime = local.filter(i => !i.typeOnly);

  it('no import cycles between files', () => {
    expect(cycles(graph(runtime.map(i => [i.from, i.to])))).toEqual([]);
  });

  // Business dependencies between modules: what their domain, application and infrastructure layers use. A route's use
  // of the session guards (identity/http.ts) or of upload handling (documents/http.ts) is request-pipeline wiring, not
  // a business dependency, so it is left out here; the file graph above still includes it, and the test below keeps
  // http.ts to those two modules.
  it('no dependency cycles between modules', () => {
    const pairs = runtime
      .filter(i => !(place(i.from).layer === 'presentation' && place(i.to).layer === 'http'))
      .map(i => [place(i.from).module, place(i.to).module] as const).filter((p): p is [string, string] => !!p[0] && !!p[1] && p[0] !== p[1]);
    expect(cycles(graph(pairs))).toEqual([]);
  });

  it('only identity (session guards) and documents (uploads, downloads) offer an http.ts', () => {
    expect(MODULES.filter(m => existsSync(path.join(SRC, 'modules', m, 'http.ts'))).sort()).toEqual(['documents', 'identity']);
  });
});

describe('architecture: data ownership', () => {
  // Every table has one module that writes it; other modules change it through that module's public functions.
  // Reads across modules are allowed (reporting reads everything); writes are not.
  const OWNER: Record<string, string> = {
    user: 'identity', authSession: 'identity', refreshToken: 'identity', userToken: 'identity', loginThrottle: 'identity',
    tier: 'administration', setting: 'administration',
    auditLog: 'audit', memberActivity: 'audit',
    document: 'documents',
    notification: 'communications', announcement: 'communications', broadcast: 'communications', resource: 'communications',
    member: 'membership', certificate: 'membership', mofRenewal: 'membership', duesPayment: 'membership', reminderLog: 'membership',
    application: 'applications',
    payment: 'payments', paymentLine: 'payments',
    event: 'events', registration: 'events',
    expense: 'finance',
    loan: 'lending', creditCheck: 'lending',
  };
  // Raw SQL writes, by table. The shared kernel allocates references; the platform holds job leases and the nightly claim.
  const RAW_OWNER: Record<string, string> = { LoginThrottle: 'identity', Counter: 'shared', JobLease: 'platform', Setting: 'platform' };
  const WRITE = /\b(?:prisma|tx|db)\.(\w+)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;
  const RAW_WRITE = /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(\w+)"/g;
  const writer = (file: string) => place(file).module ?? place(file).area;
  const writesIn = (text: string) => [...text.matchAll(WRITE)];

  it('finds the writes it checks', () => {
    expect(SOURCES.flatMap(s => writesIn(s.text)).length).toBeGreaterThan(100);
  });

  it('each table is written only by the module that owns it', () => {
    const bad = SOURCES.flatMap(({ file, text }) => writesIn(text)
      .filter(m => m[1] in OWNER && OWNER[m[1]] !== writer(file))
      .map(m => `${file} writes ${m[1]} (owned by ${OWNER[m[1]]})`));
    expect(bad).toEqual([]);
  });

  it('every model written is known to the ownership map', () => {
    expect(SOURCES.flatMap(({ file, text }) => writesIn(text).filter(m => !(m[1] in OWNER)).map(m => `${file}: ${m[1]}`))).toEqual([]);
  });

  it('raw SQL writes stay with the owner of the table', () => {
    const bad = SOURCES.flatMap(({ file, text }) => [...text.matchAll(RAW_WRITE)]
      .filter(m => RAW_OWNER[m[1]] !== writer(file))
      .map(m => `${file} writes "${m[1]}" with raw SQL`));
    expect(bad).toEqual([]);
  });

  it('reporting reads only: it writes nothing but audit entries (through the audit module)', () => {
    expect(SOURCES.filter(s => place(s.file).module === 'reporting' && writesIn(s.text).length).map(s => s.file)).toEqual([]);
  });

  it('background jobs reuse use cases: the scheduler writes no business table', () => {
    const scheduler = SOURCES.filter(s => s.file.startsWith('platform/jobs/'));
    expect(scheduler.length).toBeGreaterThan(0);
    expect(scheduler.flatMap(s => writesIn(s.text).map(m => `${s.file} writes ${m[1]}`))).toEqual([]);
  });
});

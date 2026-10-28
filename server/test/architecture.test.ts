// Keeps the layering in docs/architecture.md true: routes -> services -> lib/providers, never the other way, and
// services know nothing of HTTP. Reads the import lines of every source file; needs no database.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = path.join(dir, f);
  if (statSync(p).isDirectory()) return f === 'generated' ? [] : files(p);
  return p.endsWith('.ts') ? [p] : [];
});
const layerOf = (file: string) => path.relative(SRC, file).split(path.sep)[0].replace(/\.ts$/, '');

/** Every import of every source file, as { from: layer, file, spec, to: layer or package name }. */
const imports = files(SRC).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/gm)].map(([, spec]) => ({
  from: layerOf(file), file: path.relative(SRC, file).replaceAll(path.sep, '/'), spec,
  to: spec.startsWith('.') ? layerOf(path.resolve(path.dirname(file), spec)) : spec,
})));
const offending = (from: string[], to: string[]) =>
  imports.filter(i => from.includes(i.from) && to.includes(i.to)).map(i => `${i.file} imports ${i.spec}`);

describe('architecture: dependency direction', () => {
  it('finds the imports it checks (guards against the scan silently matching nothing)', () => {
    expect(imports.filter(i => i.from === 'routes' && i.to === 'services').length).toBeGreaterThan(10);
  });

  it('lib/ and providers/ never import services, routes or jobs', () => {
    expect(offending(['lib', 'providers'], ['services', 'routes', 'jobs'])).toEqual([]);
  });

  it('services never import routes or jobs, nor HTTP (fastify)', () => {
    expect(offending(['services'], ['routes', 'jobs', 'fastify'])).toEqual([]);
  });

  it('providers (external adapters) never touch the database: services decide what to store', () => {
    expect(imports.filter(i => i.from === 'providers' && i.spec.endsWith('/db.js')).map(i => i.file)).toEqual([]);
  });
});

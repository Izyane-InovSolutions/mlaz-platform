// Checks that each package-lock.json exists and records exactly the dependencies its package.json declares, so
// `npm ci` (used by CI) installs what the manifest says. Read-only; fix a mismatch with `npm install` in that folder.
import { existsSync, readFileSync } from 'node:fs';

const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const problems = [];

for (const dir of ['.', 'server']) {
  const read = f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  if (!existsSync(`${dir}/package-lock.json`)) { problems.push(`${dir}: package-lock.json is missing`); continue; }
  const pkg = read('package.json');
  const lock = read('package-lock.json');
  if (!(lock.lockfileVersion >= 2)) problems.push(`${dir}: lockfileVersion ${lock.lockfileVersion} is too old (regenerate with npm 7+)`);
  const root = lock.packages?.[''] ?? {};
  for (const field of FIELDS) {
    const want = pkg[field] ?? {};
    const have = root[field] ?? {};
    for (const name of new Set([...Object.keys(want), ...Object.keys(have)])) {
      if (want[name] !== have[name]) problems.push(`${dir}: ${field}.${name} is "${want[name] ?? '(absent)'}" in package.json but "${have[name] ?? '(absent)'}" in package-lock.json`);
    }
  }
  for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!lock.packages?.[`node_modules/${name}`]) problems.push(`${dir}: ${name}@${spec} has no resolved entry in package-lock.json`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error('\ncheck:lockfile: run `npm install` in the folder named above and commit the updated package-lock.json.');
  process.exit(1);
}
console.log('check:lockfile: both lockfiles match their package.json.');

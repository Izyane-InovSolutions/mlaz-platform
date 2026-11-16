// Runs the quality and security checks in order, stops at the first failure and names it.
//   node scripts/check.mjs fast       npm run check       no database or network needed (except a one-off gitleaks download)
//   node scripts/check.mjs full       npm run check:full  everything CI runs; needs the test database and the npm registry
//   node scripts/check.mjs pre-push   the Git pre-push hook: `full`, with secret and whitespace scans limited to the
//                                     commits being pushed (Git passes them on stdin)
// Add --keep-going to run every step and report all failures at the end.
// Each test runs once: test:security is a subset of `test` + `test:server`, so it is not run again here.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const mode = process.argv[2];
const keepGoing = process.argv.includes('--keep-going');
if (!['fast', 'full', 'pre-push'].includes(mode)) {
  console.error('Usage: node scripts/check.mjs fast|full|pre-push [--keep-going]');
  process.exit(2);
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const isZero = sha => /^0+$/.test(sha);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1;
// npm is npm.cmd on Windows, which needs a shell. One command string (script names are the constants below, never
// input), because Node deprecates passing an argument list together with `shell` (DEP0190).
const npm = script => () => spawnSync(`npm run ${script}`, { stdio: 'inherit', shell: true }).status ?? 1;

// For pre-push: the commits being pushed, as gitleaks log options and a base commit to diff against.
function pushedRanges() {
  const input = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
  const refs = input.split('\n').map(l => l.trim().split(/\s+/)).filter(r => r.length === 4 && !isZero(r[1]));
  if (!refs.length) refs.push(['HEAD', git('rev-parse', 'HEAD'), '', '0']); // run by hand: whatever is not on a remote yet
  return refs.map(([, local, , remote]) => {
    const known = !isZero(remote) && spawnSync('git', ['cat-file', '-e', `${remote}^{commit}`]).status === 0;
    if (known) return { label: `${remote.slice(0, 8)}..${local.slice(0, 8)}`, logOpts: `${remote}..${local}`, base: remote, local };
    // A new branch (or a remote we have not fetched): everything not already on a remote.
    const commits = git('rev-list', local, '--not', '--remotes').split('\n').filter(Boolean);
    if (!commits.length) return null;
    const oldest = commits.at(-1);
    const parent = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${oldest}^`], { encoding: 'utf8' }).stdout.trim();
    return { label: `${commits.length} new commit(s) up to ${local.slice(0, 8)}`, logOpts: `${local} --not --remotes`, base: parent || EMPTY_TREE, local };
  }).filter(Boolean);
}

const HINTS = {
  whitespace: 'Remove the trailing whitespace / conflict markers listed above, then amend or add a commit.',
  'format:check': 'Run `npm run format`, review the changes, and commit them.',
  lint: 'Fix the reported problems (`npm run lint:fix` handles some automatically).',
  typecheck: 'Fix the TypeScript errors in server/ (`npm run typecheck`).',
  'check:lockfile': 'Run `npm install` in the reported folder and commit the updated package-lock.json.',
  'security:secrets': 'Do not push. Follow "A secret was found" in docs/QUALITY_CHECKS.md (rotate the credential first).',
  'security:deps': 'Upgrade the affected package, or record an approved exception in audit-policy.json (docs/QUALITY_CHECKS.md).',
  build: 'Run `npm run build` and fix the error.',
  'build:server': 'Run `npm run build:server` and fix the error.',
  test: 'Run `npm test` and fix the failing UI tests.',
  'test:server': 'Is the test database running? `cd server && npm run db:up`. Then `npm run test:server`.',
};

const steps = [];
if (mode === 'pre-push') {
  const ranges = pushedRanges();
  const dirty = git('status', '--porcelain', '--untracked-files=no');
  if (dirty) console.warn('! You have uncommitted changes. Lint, tests and builds check the working tree, not exactly what you push.\n  For a precise result, commit or `git stash` them first.\n');
  steps.push(['whitespace', () => ranges.reduce((s, r) => run('git', ['diff', '--check', r.base, r.local]) || s, 0)]);
  steps.push(['format:check', npm('format:check')], ['lint', npm('lint')], ['typecheck', npm('typecheck')], ['check:lockfile', npm('check:lockfile')]);
  steps.push(['security:secrets', () => ranges.reduce((s, r) => {
    console.log(`Scanning ${r.label}`);
    return run(process.execPath, ['scripts/gitleaks.mjs', '--log-opts', r.logOpts]) || s;
  }, 0)]);
} else {
  steps.push(['whitespace', () => run('git', ['diff', '--check']) || run('git', ['diff', '--cached', '--check'])]);
  steps.push(['format:check', npm('format:check')], ['lint', npm('lint')], ['typecheck', npm('typecheck')]);
  if (mode === 'full') steps.push(['check:lockfile', npm('check:lockfile')]);
  steps.push(['security:secrets', npm('security:secrets')]);
}
if (mode === 'fast') steps.push(['test', npm('test')]);
else {
  // The UI build comes before the UI tests, so the CSP test also checks the built bundle.
  steps.push(['security:deps', npm('security:deps')], ['build', npm('build')], ['build:server', npm('build:server')]);
  steps.push(['test', npm('test')], ['test:server', npm('test:server')]);
}

const results = [];
const started = Date.now();
for (const [name, fn] of steps) {
  console.log(`\n━━━ ${name} ━━━`);
  const t = Date.now();
  const status = fn();
  results.push({ name, ok: status === 0, secs: ((Date.now() - t) / 1000).toFixed(1) });
  if (status !== 0) {
    console.error(`\n✖ ${name} failed. ${HINTS[name] ?? ''}`);
    if (!keepGoing) break;
  }
}

console.log(`\n━━━ summary (${mode}, ${((Date.now() - started) / 1000).toFixed(0)}s) ━━━`);
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name.padEnd(18)} ${r.secs}s`);
for (const [name] of steps.slice(results.length)) console.log(`- ${name.padEnd(18)} not run`);
const failed = results.filter(r => !r.ok).map(r => r.name);
if (failed.length) {
  console.error(`\nFAILED: ${failed.join(', ')}${mode === 'pre-push' ? '. The push was stopped.' : ''}`);
  process.exit(1);
}
console.log(`\nAll ${results.length} checks passed.`);

// Dependency vulnerability check for both packages (the UI at the root and the API in server/), read from their
// lockfiles with `npm audit`. Blocks on advisories at or above the threshold in audit-policy.json (override with
// AUDIT_LEVEL=low|moderate|high|critical), unless the advisory has an approved, unexpired exception there.
// Never changes dependencies: fix findings by hand (see docs/QUALITY_CHECKS.md, "A dependency has a vulnerability").
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const PROJECTS = [{ name: 'ui', dir: '.' }, { name: 'server', dir: 'server' }];

const policy = JSON.parse(readFileSync(new URL('../audit-policy.json', import.meta.url), 'utf8'));
const threshold = process.env.AUDIT_LEVEL || policy.threshold;
if (!LEVELS.includes(threshold)) fail(`Unknown audit threshold "${threshold}" (use one of ${LEVELS.join(', ')}).`);
const today = new Date().toISOString().slice(0, 10);

// An exception must say what it covers, why it is acceptable, who approved it, and when it must be looked at again.
const exceptions = [];
for (const e of policy.exceptions ?? []) {
  const missing = ['id', 'package', 'reason', 'approvedBy', 'expires'].filter(k => !e[k]);
  if (missing.length || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires)) fail(`Invalid exception ${JSON.stringify(e)}: needs id, package, reason, approvedBy and expires (YYYY-MM-DD).`);
  if (e.expires < today) console.warn(`! Exception ${e.id} (${e.package}) expired on ${e.expires} and no longer applies.`);
  else exceptions.push({ ...e, used: false });
}

let blocking = 0;
for (const { name, dir } of PROJECTS) {
  const res = spawnSync('npm audit --json', { cwd: dir, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(res.stdout); } catch { fail(`npm audit in ${name} produced no report:\n${res.stderr}`); }
  if (report.error) fail(`npm audit in ${name} failed: ${report.error.summary || report.error.code}. Is the registry reachable?`);

  // Each advisory appears as an object in `via` on the package it affects; strings in `via` point at other packages.
  const advisories = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via) {
      if (typeof via !== 'object') continue;
      const id = via.url?.split('/').pop() || String(via.source);
      advisories.set(`${id}:${via.name}`, { id, pkg: via.name, severity: via.severity, title: via.title, url: via.url, range: via.range, fix: vuln.fixAvailable });
    }
  }

  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(`\n${name} (${dir}): ${LEVELS.slice().reverse().map(l => `${counts[l] ?? 0} ${l}`).join(', ')}`);
  for (const a of [...advisories.values()].sort((x, y) => LEVELS.indexOf(y.severity) - LEVELS.indexOf(x.severity))) {
    const line = `${a.severity.toUpperCase()} ${a.pkg} ${a.range}: ${a.title} (${a.url})`;
    const exc = exceptions.find(e => e.id === a.id && e.package === a.pkg && (!e.project || e.project === name));
    if (LEVELS.indexOf(a.severity) < LEVELS.indexOf(threshold)) console.log(`  below threshold  ${line}`);
    else if (exc) { exc.used = true; console.log(`  EXCEPTED         ${line}\n                   approved by ${exc.approvedBy} until ${exc.expires}: ${exc.reason}`); }
    else {
      blocking++;
      const fix = a.fix === true ? 'npm audit fix would resolve it (review first)' : a.fix ? `fix: ${a.fix.name}@${a.fix.version}${a.fix.isSemVerMajor ? ' (major upgrade)' : ''}` : 'no fix available yet';
      console.error(`  BLOCKING         ${line}\n                   ${fix}`);
    }
  }
}

for (const e of exceptions.filter(x => !x.used)) console.warn(`! Exception ${e.id} (${e.package}) matched nothing; remove it from audit-policy.json.`);

if (blocking) fail(`${blocking} advisory(ies) at or above "${threshold}" without an approved exception.`);
console.log(`\nsecurity:deps: nothing at or above "${threshold}" outstanding.`);

function fail(msg) {
  console.error(`\nsecurity:deps: ${msg}`);
  process.exit(1);
}

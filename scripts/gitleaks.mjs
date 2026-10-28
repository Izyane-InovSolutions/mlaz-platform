// Secret scanning with Gitleaks (https://github.com/gitleaks/gitleaks). Gitleaks is a Go binary with no npm package,
// so this script downloads one pinned release, checks its SHA-256 against the value recorded below, and caches it in
// node_modules/.cache. No global install is needed, and CI runs the same version. Matched values are always redacted.
//   node scripts/gitleaks.mjs                    whole history + staged + unstaged changes (npm run security:secrets)
//   node scripts/gitleaks.mjs --history          whole history only (CI)
//   node scripts/gitleaks.mjs --log-opts "A..B"  only the given commits (the pre-push hook)
// Set GITLEAKS_BIN to use a gitleaks binary you installed yourself (for example where GitHub downloads are blocked).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '8.30.1';
// From gitleaks_8.30.1_checksums.txt on the official release.
const SHA256 = {
  'windows_x64.zip': 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
  'linux_x64.tar.gz': '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  'linux_arm64.tar.gz': 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  'darwin_x64.tar.gz': 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  'darwin_arm64.tar.gz': 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
};

async function ensureBinary() {
  if (process.env.GITLEAKS_BIN) return process.env.GITLEAKS_BIN;
  const os = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[process.platform];
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch];
  const asset = `${os}_${arch}.${os === 'windows' ? 'zip' : 'tar.gz'}`;
  if (!SHA256[asset]) throw new Error(`No pinned gitleaks build for ${process.platform}/${process.arch}; install gitleaks ${VERSION} and set GITLEAKS_BIN.`);

  const dir = join('node_modules', '.cache', 'gitleaks', VERSION);
  const bin = join(dir, os === 'windows' ? 'gitleaks.exe' : 'gitleaks');
  if (existsSync(bin)) return bin;

  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_${asset}`;
  console.log(`Downloading gitleaks ${VERSION} (${asset})...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) from ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== SHA256[asset]) throw new Error(`Checksum mismatch for ${asset}: expected ${SHA256[asset]}, got ${actual}. Not using it.`);

  mkdirSync(dir, { recursive: true });
  const archive = join(dir, `download.${os === 'windows' ? 'zip' : 'tar.gz'}`);
  writeFileSync(archive, data);
  // Windows' own bsdtar extracts zip files; Git Bash's GNU tar (often first on PATH) cannot.
  const tar = os === 'windows' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const out = spawnSync(tar, ['-xf', archive, '-C', dir, os === 'windows' ? 'gitleaks.exe' : 'gitleaks'], { stdio: 'inherit' });
  rmSync(archive, { force: true });
  if (out.status !== 0 || !existsSync(bin)) throw new Error('Could not extract the gitleaks binary.');
  if (os !== 'windows') chmodSync(bin, 0o755);
  return bin;
}

function scan(bin, label, args) {
  console.log(`\n> gitleaks: ${label}`);
  // Silence Git's line-ending conversion warnings (core.autocrlf on Windows), which gitleaks would log as errors.
  const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.safecrlf', GIT_CONFIG_VALUE_0: 'false' };
  const res = spawnSync(bin, [...args, '--config', '.gitleaks.toml', '--redact', '--verbose', '--no-banner', '--exit-code', '1'], { stdio: 'inherit', env });
  if (res.error) throw res.error;
  return res.status === 0;
}

const argv = process.argv.slice(2);
const logOpts = argv.includes('--log-opts') ? argv[argv.indexOf('--log-opts') + 1] : null;
let bin;
try {
  bin = await ensureBinary();
} catch (err) {
  console.error(`security:secrets: ${err.message}`);
  process.exit(2);
}

const results = [];
if (logOpts) {
  results.push(scan(bin, `commits ${logOpts}`, ['git', '--log-opts', logOpts]));
} else {
  results.push(scan(bin, 'full Git history', ['git']));
  if (!argv.includes('--history')) {
    results.push(scan(bin, 'staged changes', ['git', '--pre-commit', '--staged']));
    results.push(scan(bin, 'unstaged changes', ['git', '--pre-commit']));
  }
}

if (results.every(Boolean)) {
  console.log('\nsecurity:secrets: no secrets found.');
} else {
  console.error('\nsecurity:secrets: possible secrets found (values redacted above). See docs/QUALITY_CHECKS.md, "A secret was found".');
  process.exit(1);
}

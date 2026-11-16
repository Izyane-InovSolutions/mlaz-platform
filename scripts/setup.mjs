#!/usr/bin/env node
// First-time local setup: env files, dependencies, the Docker database, migrations and the demo seed.
//
//   npm run setup                 everything; safe to run again (it skips what is already done)
//   npm run setup -- --reset      also drop the development database and re-seed it from scratch
//   npm run setup -- --install    reinstall dependencies even if node_modules exists (npm ci)
//   npm run setup -- --no-seed    stop after the migrations
//
// Needs Node 22.13+ and Docker Desktop (or another Docker engine) running. Works in PowerShell, cmd and Git Bash.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'server');
const args = new Set(process.argv.slice(2));
const RESET = args.has('--reset'), FORCE_INSTALL = args.has('--install'), SEED = !args.has('--no-seed');
const DEFAULT_PASSWORD = 'Mlaz@2026demo';

const step = (n, text) => console.log(`\n\x1b[1m[${n}/6] ${text}\x1b[0m`);
const info = text => console.log(`  ${text}`);
const warn = text => console.log(`  \x1b[33m! ${text}\x1b[0m`);
function fail(text) {
  console.error(`\n\x1b[31m✖ ${text}\x1b[0m`);
  process.exit(1);
}
// Commands are fixed strings written in this file (never user input), so running them through the shell is safe; the
// shell is what lets Windows find npm.cmd and npx.cmd.
function run(cmd, cwd = ROOT, { quiet = false, allowFail = false } = {}) {
  if (!quiet) info(`$ ${cmd}`);
  const r = spawnSync(cmd, { cwd, shell: true, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) fail(`Command failed: ${cmd}${quiet && r.stderr ? `\n${r.stderr.trim()}` : ''}`);
  return r.status === 0;
}

/* ---------- 1. prerequisites ---------- */
step(1, 'Checking prerequisites');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) fail(`Node ${process.versions.node} is too old; install Node 22.13 or newer (the project uses 24).`);
info(`Node ${process.versions.node}`);
if (!run('docker --version', ROOT, { quiet: true, allowFail: true })) fail('Docker is not installed. Install Docker Desktop, start it, then run this again.');
if (!run('docker info', ROOT, { quiet: true, allowFail: true })) fail('Docker is installed but not running. Start Docker Desktop, wait until it says "running", then run this again.');
info('Docker is running');

/* ---------- 2. env files ---------- */
step(2, 'Environment files');
const secret = () => randomBytes(48).toString('base64url');
function ensureEnv(dir, label, fill = s => s) {
  const env = join(dir, '.env'), example = join(dir, '.env.example');
  if (existsSync(env)) {
    info(`${label}/.env already exists; leaving it as it is`);
    if (/=change-me/.test(readFileSync(env, 'utf8'))) warn(`${label}/.env still has "change-me" placeholder secrets. Replace them, or delete the file and run setup again.`);
    return;
  }
  writeFileSync(env, fill(readFileSync(example, 'utf8')));
  info(`Created ${label}/.env from .env.example`);
}
ensureEnv(ROOT, '.');
// Each secret gets its own random value in place of the "change-me" placeholders.
ensureEnv(SERVER, 'server', s => s.replace(/^(JWT_SECRET|DATA_ENCRYPTION_KEY|WEBHOOK_SECRET)=.*$/gm, (_, k) => `${k}=${secret()}`));

/* ---------- 3. dependencies ---------- */
step(3, 'Dependencies');
for (const [dir, label] of [[ROOT, 'frontend'], [SERVER, 'server']]) {
  if (!FORCE_INSTALL && existsSync(join(dir, 'node_modules'))) { info(`${label}: node_modules present (use --install to reinstall)`); continue; }
  run('npm ci', dir); // in server/ this also generates the Prisma client (postinstall)
}
info('Generating the Prisma client');
run('npx prisma generate', SERVER, { quiet: true }); // cheap; keeps the client in step with the schema after a pull

/* ---------- 4. database ---------- */
step(4, 'PostgreSQL in Docker (localhost:5435, databases mlaz and mlaz_test)');
run('docker compose up -d', SERVER);
info('Waiting for the database to accept connections…');
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = run('docker compose exec -T db pg_isready -U mlaz -d mlaz', SERVER, { quiet: true, allowFail: true });
  if (!ready) await new Promise(r => setTimeout(r, 1000));
}
if (!ready) fail('The database did not become ready within 60 seconds. Run `docker compose logs db` in server/ to see why.');
info('Database is ready');

/* ---------- 5. migrations ---------- */
step(5, 'Migrations');
if (RESET) {
  warn('--reset: dropping every table in the development database (mlaz). The test database is not touched.');
  run('npx prisma migrate reset --force', SERVER);
} else {
  run('npx prisma migrate deploy', SERVER);
}

/* ---------- 6. seed ---------- */
step(6, 'Demo data');
if (!SEED) info('Skipped (--no-seed)');
else run('npx prisma db seed', SERVER); // on a database seeded before, the seed says so and changes nothing

let password = DEFAULT_PASSWORD;
try { password = /^SEED_PASSWORD=(.+)$/m.exec(readFileSync(join(SERVER, '.env'), 'utf8'))?.[1].trim() || DEFAULT_PASSWORD; } catch { /* keep the default */ }
console.log(`
\x1b[32m✔ Setup complete.\x1b[0m

Start the app in two terminals:
  npm --prefix server run dev     API on http://localhost:3000 (with background jobs)
  npm run dev                     UI on http://localhost:5173

Demo sign-in (password: ${password}):
  Staff   http://localhost:5173/#/login/admin
          secretariat@mlaz.org.zm   Admin (approves recommendations: the checker)
          officer@mlaz.org.zm       Membership Officer (recommends: the maker)
          finance@mlaz.org.zm       Finance Officer
          comms@mlaz.org.zm         Communications Officer
  Member  info@quicklend.zm (and every seeded member email)

Start over later with:  npm run setup -- --reset
`);

// Resets and seeds mlaz_e2e before the specs run. The web servers (playwright.config.ts) are already up: the API's
// command created and migrated the database before it started.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { API_ENV, ROOT } from './support/env.ts';

export default function globalSetup() {
  execSync('npx tsx ../e2e/support/seed.ts', {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, ...API_ENV },
    stdio: 'inherit',
  });
}

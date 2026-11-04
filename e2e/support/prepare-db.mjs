// Creates the mlaz_e2e database if it is missing and applies the migrations to it. Runs (from server/) just before
// the e2e API starts, as part of its webServer command in playwright.config.ts, with DATABASE_URL set to mlaz_e2e.
/* global process, console */
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL || '';
const adminUrl = process.env.E2E_DB_ADMIN_URL || 'postgresql://mlaz:mlaz@localhost:5435/postgres';
if (!/\/mlaz_e2e(\?|$)/.test(url)) {
  console.error(`prepare-db: refusing to touch ${url || '(no DATABASE_URL)'}: the e2e suite only uses mlaz_e2e`);
  process.exit(1);
}

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
try {
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'mlaz_e2e'");
  if (!rowCount) {
    await admin.query('CREATE DATABASE mlaz_e2e');
    console.log('prepare-db: created database mlaz_e2e');
  }
} finally {
  await admin.end();
}

// Documents from earlier runs belong to rows the global setup is about to truncate.
for (const dir of [process.env.STORAGE_DIR, process.env.UPLOAD_TMP_DIR]) {
  // Only ever inside the e2e output folder (see OUTPUT_DIR in env.ts).
  if (dir && /[\\/]node_modules[\\/]\.cache[\\/]mlaz-e2e[\\/]/.test(dir)) rmSync(dir, { recursive: true, force: true });
}

execSync('npx prisma migrate deploy', { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
console.log('prepare-db: mlaz_e2e is migrated');

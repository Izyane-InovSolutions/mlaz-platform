import { execSync } from 'node:child_process';

/** Brings the test database up to the latest migration before any test runs. */
export default function setup() {
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL } });
}

import 'dotenv/config';
import { defineConfig } from 'vitest/config';

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL in .env (see .env.example).');

export default defineConfig({
  test: {
    // The app reads its configuration at import time, so the test environment is fixed here.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      JOBS_ENABLED: 'false',
      SANDBOX_SETTLE_SECONDS: '0',
      STORAGE_DRIVER: 'local',
      STORAGE_DIR: './storage-test',
      SMTP_URL: '',
      CREDIT_CHECKS_PER_DAY: '3',
      STAFF_EMAIL_DOMAIN: 'mlaz.org.zm',
      REQUIRE_STAFF_2FA: 'false',
      TRUST_PROXY_HOPS: '0',
      CORS_ORIGINS: 'http://localhost:5173',
    },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false, // the files share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

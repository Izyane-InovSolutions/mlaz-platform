// One place for the isolated end-to-end environment: ports, database, storage and the API's settings.
// Nothing here points at a developer's database (mlaz), the API test database (mlaz_test) or any real service.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Reports, traces, uploaded documents and temporary uploads. Under node_modules/.cache because git and ESLint already
// ignore it there (the HTML report contains JavaScript that `npm run lint` would otherwise scan).
export const OUTPUT_DIR = path.join(ROOT, 'node_modules', '.cache', 'mlaz-e2e');

export const API_PORT = Number(process.env.E2E_API_PORT || 3100);
export const UI_PORT = Number(process.env.E2E_UI_PORT || 5174);
export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const API_URL = `${API_ORIGIN}/api`;
export const UI_URL = `http://localhost:${UI_PORT}`;

// How the UI is served. 'dev' (default): the Vite dev server. 'preview' (E2E_UI_MODE=preview): the production bundle,
// built with `vite build` into PREVIEW_DIST (not the repository's dist/) and served by `vite preview`, which sends
// production's Content-Security-Policy, including the strict style-src the dev server has to relax (see vite.config.js).
const UI_MODES = ['dev', 'preview'] as const;
export const UI_MODE = (process.env.E2E_UI_MODE || 'dev') as (typeof UI_MODES)[number];
if (!UI_MODES.includes(UI_MODE)) throw new Error(`E2E_UI_MODE must be one of ${UI_MODES.join(', ')}, got ${UI_MODE}`);
export const PREVIEW_DIST = path.join(OUTPUT_DIR, 'dist');

// The e2e database lives in the same PostgreSQL server as the dev and API-test databases, under its own name.
export const DB_ADMIN_URL = process.env.E2E_DB_ADMIN_URL || 'postgresql://mlaz:mlaz@localhost:5435/postgres';
export const DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgresql://mlaz:mlaz@localhost:5435/mlaz_e2e';
if (!/\/mlaz_e2e(\?|$)/.test(DATABASE_URL)) throw new Error(`E2E_DATABASE_URL must name the mlaz_e2e database, got ${DATABASE_URL}`);

/** The password of every fixture account. */
export const PASSWORD = 'E2e-Fixture-Pass-2026'; // gitleaks:allow: fixture password, only for accounts seeded into the throwaway mlaz_e2e database

/** Rules out the dev and test sessions, mailers and buckets. Every variable in server/.env is overridden here. */
export const API_ENV: Record<string, string> = {
  // NODE_ENV=test exempts every client from every HTTP rate limit (global and per-route: the route limits inherit the
  // global allowList). The suite signs in dozens of times from 127.0.0.1, which the 10-per-5-minutes sign-in limit
  // would otherwise block. The Postgres-backed sign-in throttles, upload limits and the credit-check cap still apply.
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(API_PORT),
  LOG_LEVEL: 'warn',
  DATABASE_URL,
  TEST_DATABASE_URL: DATABASE_URL,
  JWT_SECRET: 'e2e-jwt-secret-not-for-production-0123456789abcdef',
  DATA_ENCRYPTION_KEY: 'e2e-data-key-not-for-production-0123456789abcdef',
  WEBHOOK_SECRET: 'e2e-webhook-secret-0123456789',
  ACCESS_TOKEN_TTL_MINUTES: '15',
  SESSION_IDLE_TIMEOUT_HOURS: '24',
  SESSION_ABSOLUTE_LIFETIME_HOURS: '168',
  REFRESH_TOKEN_TTL_DAYS: '',
  REQUIRE_STAFF_2FA: 'false',
  STAFF_EMAIL_DOMAIN: 'mlaz.org.zm',
  COOKIE_SECURE: 'false',
  TRUST_PROXY_HOPS: '0',
  RATE_LIMIT_PER_MINUTE: '300',
  CORS_ORIGINS: UI_URL,
  PUBLIC_APP_URL: UI_URL,
  STORAGE_DRIVER: 'local',
  STORAGE_DIR: path.join(OUTPUT_DIR, 'storage'),
  UPLOAD_TMP_DIR: path.join(OUTPUT_DIR, 'upload-tmp'),
  S3_BUCKET: '', S3_REGION: '', S3_ENDPOINT: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '',
  // No SMTP: emails stay in the Notification outbox (see e2e/support/seed.ts for how the tests read them).
  SMTP_URL: '',
  EMAIL_FROM: 'MLAZ E2E <no-reply@mlaz.org.zm>',
  SMS_DRIVER: 'log',
  SMS_SENDER_ID: 'MLAZ',
  PAYMENT_PROVIDER: 'sandbox',
  SANDBOX_SETTLE_SECONDS: '1',
  BUREAU_DRIVER: 'simulated',
  CREDIT_CHECKS_PER_DAY: '3',
  // The background jobs settle sandbox payments (reconcile every 10 s tick) and deliver the outbox.
  JOBS_ENABLED: 'true',
  ALLOW_SANDBOX_IN_PRODUCTION: 'false',
  SEED_PASSWORD: PASSWORD,
};

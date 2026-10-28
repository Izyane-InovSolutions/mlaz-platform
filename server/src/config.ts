import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const flag = (fallback: boolean) => z.enum(['true', 'false']).default(fallback ? 'true' : 'false').transform(v => v === 'true');
const optional = z.string().optional().default('');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  // Connections per instance (pg's own default is 10), how long a request waits for one before failing instead of
  // hanging, and an optional cap on any single SQL statement (0 = none; reports and exports can take a while).
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(10),
  DB_STATEMENT_TIMEOUT_SECONDS: z.coerce.number().int().min(0).max(3600).default(0),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(15),
  // A session ends after this long without a refresh (idle), and in any case this long after sign-in (absolute).
  // Refreshing never moves the absolute deadline. Lowering either value also shortens sessions that already exist.
  SESSION_IDLE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  SESSION_ABSOLUTE_LIFETIME_HOURS: z.coerce.number().int().min(1).max(2160).default(168),
  // Encrypts secrets at rest (two-factor keys). At least 32 characters; changing it disables existing 2FA enrolments.
  DATA_ENCRYPTION_KEY: z.string().min(32, 'DATA_ENCRYPTION_KEY must be at least 32 characters'),
  REQUIRE_STAFF_2FA: flag(false),
  // Staff accounts may only be created for this email domain (e.g. mlaz.org.zm). Empty = any domain.
  STAFF_EMAIL_DOMAIN: optional,

  // The refresh token lives in an httpOnly cookie. Secure (HTTPS-only) defaults on in production.
  COOKIE_SECURE: z.enum(['true', 'false']).optional().transform(v => (v === undefined ? undefined : v === 'true')),
  // Only trust X-Forwarded-For from this many proxy hops (e.g. 1 behind a single load balancer). 0 = direct connections.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),

  CORS_ORIGINS: z.string().default('http://localhost:5173').transform(s => s.split(',').map(x => x.trim()).filter(Boolean)),
  PUBLIC_APP_URL: z.url().default('http://localhost:5173').transform(s => s.replace(/\/+$/, '')),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('./storage'),
  // Uploads stream to private temporary files (never held in memory), then move to storage once validated.
  UPLOAD_TMP_DIR: z.string().default(path.join(os.tmpdir(), 'mlaz-uploads')),
  UPLOAD_MAX_FILE_MB: z.coerce.number().int().min(1).max(50).default(10),
  UPLOAD_MAX_CONCURRENT: z.coerce.number().int().min(1).max(200).default(8), // uploads in progress per instance
  UPLOAD_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(900).default(120), // to receive a whole upload
  UPLOAD_TEMP_QUOTA_MB: z.coerce.number().int().min(10).default(400), // bytes in temporary files per instance
  STORAGE_QUOTA_MB: z.coerce.number().int().min(1).default(20_480), // all stored documents together
  S3_BUCKET: optional,
  S3_REGION: optional,
  S3_ENDPOINT: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,

  SMTP_URL: optional,
  EMAIL_FROM: z.string().default('MLAZ Secretariat <no-reply@mlaz.org.zm>'),
  SMS_DRIVER: z.enum(['log']).default('log'),
  SMS_SENDER_ID: z.string().default('MLAZ'),

  PAYMENT_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  SANDBOX_SETTLE_SECONDS: z.coerce.number().int().min(0).default(5),
  // How long a payer waits for the gateway to accept a payment request before being told to try again. A gateway that
  // answers later still has its reference recorded, so its eventual confirmation is applied.
  PAYMENT_INITIATE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(30),
  WEBHOOK_SECRET: z.string().min(8),

  BUREAU_DRIVER: z.enum(['simulated']).default('simulated'),
  CREDIT_CHECKS_PER_DAY: z.coerce.number().int().positive().default(50),

  JOBS_ENABLED: flag(true),
  ALLOW_SANDBOX_IN_PRODUCTION: flag(false),
}).refine(c => c.SESSION_ABSOLUTE_LIFETIME_HOURS >= c.SESSION_IDLE_TIMEOUT_HOURS, {
  path: ['SESSION_ABSOLUTE_LIFETIME_HOURS'], message: 'must be at least SESSION_IDLE_TIMEOUT_HOURS',
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export type Config = z.infer<typeof schema>;
export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
export const cookieSecure = config.COOKIE_SECURE ?? isProd;
// Replaced by the idle and absolute session limits; say so rather than silently ignore it.
if (process.env.REFRESH_TOKEN_TTL_DAYS) console.warn('REFRESH_TOKEN_TTL_DAYS is no longer used: set SESSION_IDLE_TIMEOUT_HOURS and SESSION_ABSOLUTE_LIFETIME_HOURS instead.');

/** Settings that would leave a production server open. Pure, so the rules can be tested without exiting. */
export function productionProblems(c: Config, env: Record<string, string | undefined>) {
  const problems: string[] = [];
  const secure = c.COOKIE_SECURE ?? true;
  const secrets = ['JWT_SECRET', 'WEBHOOK_SECRET', 'DATA_ENCRYPTION_KEY'] as const;
  for (const k of secrets) if (/change-me|example|secret/i.test(c[k]) || new Set(c[k]).size < 12) problems.push(`${k} looks like a placeholder or low-entropy value`);
  if (new Set(secrets.map(k => c[k])).size < secrets.length) problems.push('JWT_SECRET, WEBHOOK_SECRET and DATA_ENCRYPTION_KEY must all be different');
  if (c.PAYMENT_PROVIDER === 'sandbox' && !c.ALLOW_SANDBOX_IN_PRODUCTION) problems.push('PAYMENT_PROVIDER=sandbox collects no real money (set ALLOW_SANDBOX_IN_PRODUCTION=true only for a staging site)');
  if (!secure) problems.push('COOKIE_SECURE must be true in production (serve over HTTPS)');
  if (c.CORS_ORIGINS.some(o => !o.startsWith('https://'))) problems.push('CORS_ORIGINS must all be https:// origins in production');
  if (!c.PUBLIC_APP_URL.startsWith('https://')) problems.push('PUBLIC_APP_URL must be https:// in production');
  // Without SMTP, emails (with their set-password and reset links) would only be written to the server log.
  if (!c.SMTP_URL) problems.push('SMTP_URL must be set in production (otherwise password links are only logged, never delivered)');
  // The console holds identity documents and financial records: a password alone is not enough.
  if (!c.REQUIRE_STAFF_2FA) problems.push('REQUIRE_STAFF_2FA must be true in production');
  // Behind a proxy, 0 hops makes every client share the proxy's IP (one rate-limit bucket, useless audit IPs).
  if (env.TRUST_PROXY_HOPS === undefined || env.TRUST_PROXY_HOPS.trim() === '') problems.push('Set TRUST_PROXY_HOPS explicitly in production: the number of proxies in front of the API (0 if clients connect directly)');
  return problems;
}

// Production refuses to start on settings that would leave it open.
if (isProd) {
  const problems = productionProblems(config, process.env);
  if (problems.length) {
    console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
}

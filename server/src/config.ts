import 'dotenv/config';
import { z } from 'zod';

const flag = (fallback: boolean) => z.enum(['true', 'false']).default(fallback ? 'true' : 'false').transform(v => v === 'true');
const optional = z.string().optional().default('');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(30),
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
  WEBHOOK_SECRET: z.string().min(8),

  BUREAU_DRIVER: z.enum(['simulated']).default('simulated'),
  CREDIT_CHECKS_PER_DAY: z.coerce.number().int().positive().default(50),

  JOBS_ENABLED: flag(true),
  ALLOW_SANDBOX_IN_PRODUCTION: flag(false),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
export const cookieSecure = config.COOKIE_SECURE ?? isProd;

// Production refuses to start on settings that would leave it open.
if (isProd) {
  const problems: string[] = [];
  const secrets = ['JWT_SECRET', 'WEBHOOK_SECRET', 'DATA_ENCRYPTION_KEY'] as const;
  for (const k of secrets) if (/change-me|example|secret/i.test(config[k]) || new Set(config[k]).size < 12) problems.push(`${k} looks like a placeholder or low-entropy value`);
  if (new Set(secrets.map(k => config[k])).size < secrets.length) problems.push('JWT_SECRET, WEBHOOK_SECRET and DATA_ENCRYPTION_KEY must all be different');
  if (config.PAYMENT_PROVIDER === 'sandbox' && !config.ALLOW_SANDBOX_IN_PRODUCTION) problems.push('PAYMENT_PROVIDER=sandbox collects no real money (set ALLOW_SANDBOX_IN_PRODUCTION=true only for a staging site)');
  if (!cookieSecure) problems.push('COOKIE_SECURE must be true in production (serve over HTTPS)');
  if (config.CORS_ORIGINS.some(o => !o.startsWith('https://'))) problems.push('CORS_ORIGINS must all be https:// origins in production');
  if (!config.PUBLIC_APP_URL.startsWith('https://')) problems.push('PUBLIC_APP_URL must be https:// in production');
  if (problems.length) {
    console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
}

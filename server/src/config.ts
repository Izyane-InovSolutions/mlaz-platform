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
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

if (isProd) {
  const weak = (['JWT_SECRET', 'WEBHOOK_SECRET'] as const).filter(k => config[k].includes('change-me'));
  if (weak.length) {
    console.error(`Refusing to start in production with placeholder secrets: ${weak.join(', ')}`);
    process.exit(1);
  }
  if (config.PAYMENT_PROVIDER === 'sandbox') console.warn('WARNING: PAYMENT_PROVIDER=sandbox in production. No real money will be collected.');
}

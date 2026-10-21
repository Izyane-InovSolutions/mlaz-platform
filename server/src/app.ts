import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config, isProd, isTest } from './config.js';
import { Prisma, prisma } from './lib/db.js';
import { AppError } from './lib/errors.js';
import { requireStaff } from './lib/guards.js';
import adminEngageRoutes from './routes/admin-engage.js';
import adminFinanceRoutes from './routes/admin-finance.js';
import adminMemberRoutes from './routes/admin-members.js';
import adminSystemRoutes from './routes/admin-system.js';
import authRoutes from './routes/auth.js';
import portalRoutes from './routes/portal.js';
import publicRoutes from './routes/public.js';
import webhookRoutes from './routes/webhooks.js';

// Kwacha amounts come out of Prisma as Decimal objects; send them to clients as plain numbers.
function jsonReplacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = this[key];
  return Prisma.Decimal.isDecimal(raw) ? (raw as Prisma.Decimal).toNumber() : value;
}

// Tokens that can appear in URLs (applicant tracking links, set-password links) must never reach the logs.
const redactUrl = (url: string) => url.replace(/([?&](?:t|token)=)[^&]+/g, '$1[redacted]');

export async function buildApp() {
  const app = Fastify({
    logger: isTest ? false : {
      level: config.LOG_LEVEL,
      serializers: { req: req => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }) },
      ...(!isProd && { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
    },
    // Client IPs (used by rate limits and the audit trail) come from X-Forwarded-For only behind a known number of proxies;
    // otherwise anyone could fake their address.
    trustProxy: config.TRUST_PROXY_HOPS ? (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS : false,
    bodyLimit: 1024 * 1024,
    maxParamLength: 200,
  });

  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-tracking-token', 'x-mlaz-csrf'],
    exposedHeaders: ['content-disposition'],
    maxAge: 600,
  });
  // A ceiling for every route per client IP; sensitive routes set tighter limits of their own. Tests are exempt
  // because they sign in many times from one address.
  await app.register(rateLimit, { global: true, max: config.RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute', allowList: () => isTest });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 4, fields: 40, fieldSize: 10_000, parts: 50, headerPairs: 200 } });

  // Personal data must not be kept by browser or proxy caches.
  app.addHook('onSend', async (req, reply, payload) => {
    if (!reply.hasHeader('cache-control') && /^\/api\/(auth|portal|admin|public\/applications)/.test(req.url)) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setReplySerializer(payload => JSON.stringify(payload, jsonReplacer));

  app.setErrorHandler((err: FastifyError | AppError | ZodError | Error, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) {
      const fields = err.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
      return reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: fields.map(f => (f.field ? `${f.field}: ${f.message}` : f.message)).join('; '), details: { fields } } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'A record with these details already exists.' } });
      if (err.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found.' } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: { code: (err as FastifyError).code ?? 'BAD_REQUEST', message: err.message } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }));

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  });

  await app.register(async api => {
    await api.register(authRoutes, { prefix: '/auth' });
    await api.register(publicRoutes, { prefix: '/public' });
    await api.register(portalRoutes, { prefix: '/portal' });
    await api.register(async admin => {
      admin.addHook('preHandler', requireStaff());
      await admin.register(adminSystemRoutes);
      await admin.register(adminMemberRoutes);
      await admin.register(adminFinanceRoutes);
      await admin.register(adminEngageRoutes);
    }, { prefix: '/admin' });
    await api.register(webhookRoutes, { prefix: '/webhooks' });
  }, { prefix: '/api' });

  return app;
}

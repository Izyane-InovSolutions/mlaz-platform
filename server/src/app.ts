import { randomUUID } from 'node:crypto';
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
import { multipartLimits, prepareUploadDir, releaseUploads } from './lib/uploads.js';
import { validationFailed } from './lib/validate.js';
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

const HEALTH_DB_TIMEOUT_MS = 2000;

// Tokens that can appear in URLs (applicant tracking links, set-password links) must never reach the logs.
const redactUrl = (url: string) => url.replace(/([?&](?:t|token)=)[^&]+/g, '$1[redacted]');

export async function buildApp() {
  const app = Fastify({
    logger: isTest ? false : {
      level: config.LOG_LEVEL,
      serializers: { req: req => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }) },
      // Safety net: credentials never reach the log, even if a future log call passes a whole body or headers object.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.newPassword', '*.currentPassword', '*.token',
          '*.accessToken', '*.refreshToken', '*.mfaToken', '*.secret', '*.headers.authorization', '*.headers.cookie'],
        censor: '[redacted]',
      },
      ...(!isProd && { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
    },
    // Client IPs (used by rate limits and the audit trail) come from X-Forwarded-For only behind a known number of proxies;
    // otherwise anyone could fake their address.
    trustProxy: config.TRUST_PROXY_HOPS ? (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS : false,
    bodyLimit: 1024 * 1024,
    routerOptions: { maxParamLength: 200 },
    // Every log line of a request carries its id, and the client gets it back in x-request-id to quote in a support
    // request. A well-formed id from a proxy in front is kept, so one id follows the request through both.
    requestIdHeader: false,
    genReqId: req => {
      const id = req.headers['x-request-id'];
      return typeof id === 'string' && /^[\w.-]{8,64}$/.test(id) ? id : randomUUID();
    },
    // Backstop for any request body that trickles in; uploads have their own, shorter limit (UPLOAD_TIMEOUT_SECONDS).
    requestTimeout: (config.UPLOAD_TIMEOUT_SECONDS + 30) * 1000,
  });
  await prepareUploadDir();

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
    exposedHeaders: ['content-disposition', 'x-request-id'],
    maxAge: 600,
  });
  // A ceiling for every route per client IP; sensitive routes set tighter limits of their own. Tests are exempt
  // because they sign in many times from one address.
  await app.register(rateLimit, { global: true, max: config.RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute', allowList: () => isTest });
  await app.register(multipart, { limits: multipartLimits() });
  // Temporary upload files go when the response does, whether the request succeeded, failed or was abandoned.
  app.addHook('onResponse', async req => releaseUploads(req));
  app.addHook('onRequestAbort', async req => releaseUploads(req));

  // Personal data must not be kept by browser or proxy caches.
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    if (!reply.hasHeader('cache-control') && /^\/api\/(auth|portal|admin|public\/applications)/.test(req.url)) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setReplySerializer(payload => JSON.stringify(payload, jsonReplacer));

  app.setErrorHandler((error: FastifyError | AppError | ZodError | Error, req, reply) => {
    const err = error instanceof ZodError ? validationFailed(error) : error;
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'A record with these details already exists.' } });
      if (err.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found.' } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: { code: (err as FastifyError).code ?? 'BAD_REQUEST', message: err.message } });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId: req.id } });
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }));

  // Content-Security-Policy violation reports from the UI (report-uri / report-to). Only the directive and the origins
  // and paths involved are logged: never query strings, fragments, page content or cookies.
  const cspTypes = ['application/csp-report', 'application/reports+json'];
  app.addContentTypeParser(cspTypes, { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    try { done(null, JSON.parse(body as string)); } catch { done(null, null); }
  });
  const originOf = (u: unknown) => {
    if (typeof u !== 'string') return undefined;
    try { const x = new URL(u); return `${x.origin}${x.pathname}`.slice(0, 200); } catch { return u.slice(0, 40); } // 'inline', 'eval'…
  };
  app.post('/api/csp-report', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = req.body as Record<string, unknown> | Record<string, unknown>[] | null;
    const reports = (Array.isArray(raw) ? raw.map(r => r.body) : [raw?.['csp-report']]).filter(Boolean).slice(0, 20) as Record<string, unknown>[];
    for (const r of reports) {
      req.log.warn({ csp: {
        directive: String(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? '').slice(0, 60),
        blocked: originOf(r['blocked-uri'] ?? r.blockedURL), page: originOf(r['document-uri'] ?? r.documentURL),
        disposition: String(r.disposition ?? '').slice(0, 12),
      } }, 'CSP violation');
    }
    return reply.status(204).send();
  });

  // Probes: /health/live says the process is serving (restart it if not); /health says it can do real work, because the
  // database answers within HEALTH_DB_TIMEOUT_MS (take it out of the load balancer if not). Fastify answers 503 to both
  // while shutting down. Never rate limited, so a busy instance is not reported dead by its own probe.
  const probe = { config: { rateLimit: false } };
  app.get('/health/live', probe, async () => ({ ok: true }));
  app.get('/health', probe, async (req, reply) => {
    let timer: NodeJS.Timeout | undefined;
    const ready = await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => true),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), HEALTH_DB_TIMEOUT_MS); }),
    ]).catch(err => {
      req.log.warn({ err }, 'health check: database unavailable');
      return false;
    }).finally(() => clearTimeout(timer));
    if (!ready) return reply.status(503).send({ error: { code: 'NOT_READY', message: 'The database is not answering.' } });
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

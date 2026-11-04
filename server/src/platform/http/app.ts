import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { config, isTest } from '../../config.js';
import { Prisma } from '../../shared/db.js';
import { rootLogger, runWithLogger } from '../../shared/log.js';
import type { RouteScope } from '../../shared/module.js';
import { multipartLimits, prepareUploadDir, releaseUploads } from '../../modules/documents/http.js';
import { requireMember, requireStaff } from '../../modules/identity/http.js';
import { MODULES, wireModules } from '../modules.js';
import { registerErrorHandling } from './error-handler.js';
import { registerCspReports, registerHealthProbes, registerStatusEndpoint } from './operations.js';

// Kwacha amounts come out of Prisma as Decimal objects; send them to clients as plain numbers.
function jsonReplacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = this[key];
  return Prisma.Decimal.isDecimal(raw) ? (raw as Prisma.Decimal).toNumber() : value;
}

/** Mounts every module's routes for one scope inside `api`, under the scope's prefix and behind its guard. */
async function mountScope(api: FastifyInstance, scope: RouteScope, prefix: string, guard?: (app: FastifyInstance) => void) {
  await api.register(async s => {
    guard?.(s);
    for (const m of MODULES) {
      const routes = m.routes?.[scope];
      if (routes) await s.register(routes);
    }
  }, { prefix });
}

export async function buildApp() {
  wireModules();
  const app = Fastify({
    // The process-wide structured log (shared/log.ts): JSON in production, with secrets and URL tokens redacted.
    loggerInstance: rootLogger as FastifyBaseLogger, // a pino logger; typed as Fastify's view of one
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
  // From here on, log() in any module returns this request's logger, so a use case's log lines carry the request id.
  // preValidation, not onRequest: body parsing runs on socket events, which would leave an earlier context behind.
  app.addHook('preValidation', (req, _reply, done) => runWithLogger(req.log, done));

  // Personal data must not be kept by browser or proxy caches.
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    if (!reply.hasHeader('cache-control') && /^\/api\/(auth|portal|admin|public\/applications)/.test(req.url)) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setReplySerializer(payload => JSON.stringify(payload, jsonReplacer));
  registerErrorHandling(app);
  registerCspReports(app);
  registerHealthProbes(app);
  registerStatusEndpoint(app);

  // Each module's routes, mounted per scope. The scope decides who may call them (see shared/module.ts).
  await app.register(async api => {
    await mountScope(api, 'auth', '/auth');
    await mountScope(api, 'public', '/public');
    await mountScope(api, 'portal', '/portal', s => s.addHook('preHandler', requireMember));
    await mountScope(api, 'admin', '/admin', s => s.addHook('preHandler', requireStaff()));
    await mountScope(api, 'webhooks', '/webhooks');
  }, { prefix: '/api' });

  return app;
}

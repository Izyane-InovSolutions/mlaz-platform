import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, stdSerializers, type BaseLogger, type LoggerOptions } from 'pino';
import { config, isProd, isTest } from '../config.js';

/** What module code may do with a logger: write lines. Fastify's request logger and the process logger both qualify. */
export type Log = Pick<BaseLogger, 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

// One structured (JSON) log for the whole process: the HTTP server's request log and every module's own events go
// through it, with the same redaction. Operational events carry an `event` field (e.g. `outbox.send_failed`) that
// monitoring can count and alert on; docs/OPERATIONS.md lists them.

// Values that must never be written to a log, wherever they appear (top level or one object down). A safety net: log
// calls should not pass bodies, headers or credentials in the first place. Error codes (`err.code`) are kept on purpose.
const SECRET_KEYS = ['password', 'newPassword', 'currentPassword', 'token', 'accessToken', 'refreshToken', 'mfaToken', 'secret',
  'otp', 'totp', 'mfaCode', 'recoveryCode', 'recoveryCodes', 'sessionId', 'cookie', 'authorization', 'nrc', 'report'];

/** Tokens that can appear in URLs (applicant tracking links, set-password links) must never reach the logs. */
const redactUrl =(url: string) => url.replace(/([?&](?:t|token)=)[^&]+/g, '$1[redacted]');

export const LOG_OPTIONS: LoggerOptions = {
  level: isTest ? 'silent' : config.LOG_LEVEL,
  base: { service: 'mlaz-api' },
  // Fastify's own serializers, except that query-string tokens are removed from URLs.
  serializers: {
    req: (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    err: stdSerializers.err,
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', ...SECRET_KEYS.flatMap(k => [k, `*.${k}`])],
    censor: '[redacted]',
  },
  ...(!isProd && !isTest && { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' } } }),
};

export const rootLogger = pino(LOG_OPTIONS);

const current = new AsyncLocalStorage<Log>();

/**
 * The logger for the work in progress: inside a request, that request's logger (every line carries its `reqId`, which
 * the client also gets back in x-request-id); in a background job or at startup, the process logger.
 */
export const log = (): Log => current.getStore() ?? rootLogger;

/** Runs `fn` (and everything it awaits) with `logger` as the current logger. Used once per request by the platform. */
export const runWithLogger = <T>(logger: Log, fn: () => T) => current.run(logger, fn);

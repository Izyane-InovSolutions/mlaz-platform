import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config, cookieSecure } from '../config.js';
import { passwordSchema } from '../lib/auth.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { authenticate, userOf } from '../lib/guards.js';
import { parse, s } from '../lib/validate.js';
import * as accounts from '../services/accounts.js';
import { rateLimit } from './helpers.js';

// The refresh token never reaches page scripts: it lives in an httpOnly, SameSite=Strict cookie that the browser only
// sends to /api/auth. Endpoints that act on that cookie also require an allowed Origin and a custom header, which a
// cross-site form cannot send.
export const REFRESH_COOKIE = 'mlaz_rt';
// Marks a browser that has signed in to an account before (see recognisedDevice in services/accounts.ts).
export const DEVICE_COOKIE = 'mlaz_dev';
const COOKIE_PATH = '/api/auth';

/** "Keep me signed in" keeps the cookie until the session's absolute deadline, never longer. */
function setRefreshCookie(reply: FastifyReply, token: string, remember: boolean, sessionExpiresAt: Date) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: COOKIE_PATH,
    ...(remember && { maxAge: Math.max(1, Math.floor((sessionExpiresAt.getTime() - Date.now()) / 1000)) }),
  });
}
function rememberDevice(req: FastifyRequest, reply: FastifyReply, email: string) {
  const { value, maxAge } = accounts.deviceCookieAfterSignIn(req.cookies[DEVICE_COOKIE], email);
  reply.setCookie(DEVICE_COOKIE, value, { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: COOKIE_PATH, maxAge });
}
const clearRefreshCookie = (reply: FastifyReply) => reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, secure: cookieSecure, sameSite: 'strict' });

function assertCookieRequest(req: FastifyRequest) {
  const origin = req.headers.origin;
  if (origin && !config.CORS_ORIGINS.includes(origin)) throw forbidden('Request origin not allowed.', 'BAD_ORIGIN');
  if (req.headers['x-mlaz-csrf'] !== '1') throw forbidden('Missing request header.', 'CSRF');
}

/** Sends a session: access token in the body, refresh token in the cookie only. */
function sendSession(reply: FastifyReply, session: accounts.Session) {
  const { refreshToken, ...body } = session;
  setRefreshCookie(reply, refreshToken, session.remember, session.sessionExpiresAt);
  return reply.send(body);
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', rateLimit(10, '5 minutes'), async (req, reply) => {
    const v = parse(z.object({ email: s.email, password: z.string().min(1).max(200), portal: z.enum(['staff', 'member']).optional(), remember: z.boolean().default(false) }), req.body);
    const r = await accounts.login(v.email, v.password, v.portal, v.remember, req.ip, req.cookies[DEVICE_COOKIE]);
    if ('mfaRequired' in r) return r;
    rememberDevice(req, reply, r.user.email);
    return sendSession(reply, r);
  });

  app.post('/login/mfa', rateLimit(10, '5 minutes'), async (req, reply) => {
    const v = parse(z.object({ mfaToken: z.string().min(20).max(1000), code: z.string().trim().min(6).max(20) }), req.body);
    const session = await accounts.completeMfa(v.mfaToken, v.code, req.ip);
    rememberDevice(req, reply, session.user.email);
    return sendSession(reply, session);
  });

  app.post('/refresh', rateLimit(30, '1 minute'), async (req, reply) => {
    assertCookieRequest(req);
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized('Your session has ended. Sign in again.');
    const v = parse(z.object({ remember: z.boolean().default(false) }), req.body ?? {});
    try {
      return sendSession(reply, await accounts.refresh(token, v.remember));
    } catch (e) {
      clearRefreshCookie(reply);
      throw e;
    }
  });

  app.post('/logout', async (req, reply) => {
    assertCookieRequest(req);
    const token = req.cookies[REFRESH_COOKIE];
    if (token) await accounts.logout(token);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  /** Ends every session of the signed-in user on every device. */
  app.post('/logout-all', async (req, reply) => {
    await authenticate(req);
    await accounts.logoutEverywhere(userOf(req), req.ip);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  app.get('/me', async req => {
    await authenticate(req);
    return { ...(await accounts.profile(userOf(req).id)), mfaSetupPending: !!req.mfaSetupPending };
  });

  app.post('/password/forgot', rateLimit(5, '15 minutes'), async (req, reply) => {
    const v = parse(z.object({ email: s.email }), req.body);
    await accounts.requestPasswordReset(v.email);
    return reply.status(204).send();
  });

  /** Sets a password from an invite or reset link. */
  app.post('/password/set', rateLimit(10, '15 minutes'), async req => {
    const v = parse(z.object({ token: z.string().min(20).max(200), password: passwordSchema }), req.body);
    return accounts.setPassword(v.token, v.password, req.ip);
  });

  app.post('/password/change', rateLimit(10, '15 minutes'), async (req, reply) => {
    await authenticate(req);
    const v = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema, remember: z.boolean().default(false) }), req.body);
    return sendSession(reply, await accounts.changePassword(userOf(req), v.currentPassword, v.newPassword, v.remember, req.ip));
  });

  /* ---------- two-factor sign-in (allowed while a required enrolment is pending) ---------- */
  const code = z.string().trim().min(6).max(20);
  app.post('/mfa/setup', rateLimit(10, '15 minutes'), async req => {
    await authenticate(req);
    return accounts.beginMfaSetup(userOf(req));
  });
  app.post('/mfa/confirm', rateLimit(10, '15 minutes'), async req => {
    await authenticate(req);
    return accounts.confirmMfaSetup(userOf(req), parse(z.object({ code }), req.body).code, req.ip);
  });
  app.post('/mfa/disable', rateLimit(10, '15 minutes'), async (req, reply) => {
    await authenticate(req);
    const v = parse(z.object({ password: z.string().min(1).max(200), code }), req.body);
    await accounts.disableMfa(userOf(req), v.password, v.code, req.ip);
    return reply.status(204).send();
  });
  app.post('/mfa/recovery-codes', rateLimit(5, '15 minutes'), async req => {
    await authenticate(req);
    return accounts.regenerateRecoveryCodes(userOf(req), parse(z.object({ code }), req.body).code, req.ip);
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config, cookieSecure } from '../../../config.js';
import { forbidden, unauthorized } from '../../../shared/errors.js';
import { rateLimit } from '../../../shared/http.js';
import { parse, s } from '../../../shared/validation.js';
import { passwordSchema } from '../domain/users.js';
import { deviceCookieAfterSignIn } from '../application/devices.js';
import { beginMfaSetup, confirmMfaSetup, disableMfa, regenerateRecoveryCodes } from '../application/mfa.js';
import { changePassword, requestPasswordReset, setPassword } from '../application/passwords.js';
import { SESSION_ENDED, type Session, logout, logoutEverywhere, profile, refresh } from '../application/sessions.js';
import { completeMfa, login } from '../application/sign-in.js';
import { authenticate, sessionIdOf, userOf } from './guards.js';

// The refresh token never reaches page scripts: it lives in an httpOnly, SameSite=Strict cookie that the browser only
// sends to /api/auth. Endpoints that act on that cookie also require an allowed Origin and a custom header, which a
// cross-site form cannot send.
export const REFRESH_COOKIE = 'mlaz_rt';
// Marks a browser that has signed in to an account before (see application/devices.ts).
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
  const { value, maxAge } = deviceCookieAfterSignIn(req.cookies[DEVICE_COOKIE], email);
  reply.setCookie(DEVICE_COOKIE, value, { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: COOKIE_PATH, maxAge });
}
const clearRefreshCookie = (reply: FastifyReply) => reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, secure: cookieSecure, sameSite: 'strict' });

function assertCookieRequest(req: FastifyRequest) {
  const origin = req.headers.origin;
  if (origin && !config.CORS_ORIGINS.includes(origin)) throw forbidden('Request origin not allowed.', 'BAD_ORIGIN');
  if (req.headers['x-mlaz-csrf'] !== '1') throw forbidden('Missing request header.', 'CSRF');
}

/** Sends a session: access token in the body, refresh token in the cookie only. */
function sendSession(reply: FastifyReply, session: Session) {
  const { refreshToken, ...body } = session;
  setRefreshCookie(reply, refreshToken, session.remember, session.sessionExpiresAt);
  return reply.send(body);
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', rateLimit(10, '5 minutes'), async (req, reply) => {
    const v = parse(z.object({ email: s.email, password: z.string().min(1).max(200), portal: z.enum(['staff', 'member']).optional(), remember: z.boolean().default(false) }), req.body);
    const r = await login(v.email, v.password, v.portal, v.remember, req.ip, req.cookies[DEVICE_COOKIE]);
    if ('mfaRequired' in r) return r;
    rememberDevice(req, reply, r.user.email);
    return sendSession(reply, r);
  });

  app.post('/login/mfa', rateLimit(10, '5 minutes'), async (req, reply) => {
    const v = parse(z.object({ mfaToken: z.string().min(20).max(1000), code: z.string().trim().min(6).max(20) }), req.body);
    const session = await completeMfa(v.mfaToken, v.code, req.ip, req.cookies[DEVICE_COOKIE]);
    rememberDevice(req, reply, session.user.email);
    return sendSession(reply, session);
  });

  app.post('/refresh', rateLimit(30, '1 minute'), async (req, reply) => {
    assertCookieRequest(req);
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized(SESSION_ENDED);
    const v = parse(z.object({ remember: z.boolean().default(false) }), req.body ?? {});
    try {
      return sendSession(reply, await refresh(token, v.remember));
    } catch (e) {
      clearRefreshCookie(reply);
      throw e;
    }
  });

  app.post('/logout', async (req, reply) => {
    assertCookieRequest(req);
    const token = req.cookies[REFRESH_COOKIE];
    if (token) await logout(token);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  /** Ends every session of the signed-in user on every device. */
  app.post('/logout-all', async (req, reply) => {
    await authenticate(req);
    await logoutEverywhere(userOf(req), req.ip);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  app.get('/me', async req => {
    await authenticate(req);
    return { ...(await profile(userOf(req).id)), mfaSetupPending: !!req.mfaSetupPending };
  });

  app.post('/password/forgot', rateLimit(5, '15 minutes'), async (req, reply) => {
    const v = parse(z.object({ email: s.email }), req.body);
    await requestPasswordReset(v.email);
    return reply.status(204).send();
  });

  /** Sets a password from an invite or reset link. */
  app.post('/password/set', rateLimit(10, '15 minutes'), async req => {
    const v = parse(z.object({ token: z.string().min(20).max(200), password: passwordSchema }), req.body);
    return setPassword(v.token, v.password, req.ip);
  });

  app.post('/password/change', rateLimit(10, '15 minutes'), async (req, reply) => {
    await authenticate(req);
    const v = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema, remember: z.boolean().default(false) }), req.body);
    return sendSession(reply, await changePassword(userOf(req), v.currentPassword, v.newPassword, v.remember, req.ip));
  });

  /* ---------- two-factor sign-in (allowed while a required enrolment is pending) ---------- */
  const code = z.string().trim().min(6).max(20);
  app.post('/mfa/setup', rateLimit(10, '15 minutes'), async req => {
    await authenticate(req);
    return beginMfaSetup(userOf(req));
  });
  app.post('/mfa/confirm', rateLimit(10, '15 minutes'), async req => {
    await authenticate(req);
    return confirmMfaSetup(userOf(req), parse(z.object({ code }), req.body).code, req.ip);
  });
  app.post('/mfa/disable', rateLimit(10, '15 minutes'), async (req, reply) => {
    await authenticate(req);
    const v = parse(z.object({ password: z.string().min(1).max(200), code }), req.body);
    await disableMfa(userOf(req), sessionIdOf(req), v.password, v.code, req.ip);
    return reply.status(204).send();
  });
  app.post('/mfa/recovery-codes', rateLimit(5, '15 minutes'), async req => {
    await authenticate(req);
    return regenerateRecoveryCodes(userOf(req), sessionIdOf(req), parse(z.object({ code }), req.body).code, req.ip);
  });
}

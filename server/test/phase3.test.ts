// Phase 3 regression tests: distributed account lock-out (R1), in-memory uploads (R2), indefinite session refresh (R3)
// and the Content-Security-Policy (R4, server side; the UI policy is tested in ../../test/csp.test.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/db.js';
import { storage } from '../src/lib/storage.js';
import { sha256 } from '../src/lib/tokens.js';
import { maxFileBytes, uploadStats } from '../src/lib/uploads.js';
import { logLineFor } from '../src/providers/messaging.js';
import { LIMITS } from '../src/services/accounts.js';
import { PASSWORD, PDF, STAFF, bearer, getApp, login, makeMember, refreshWith, resetDb, tokenFromEmail } from './helpers.js';

const STORAGE = path.resolve(config.STORAGE_DIR);
const TMP = path.resolve(config.UPLOAD_TMP_DIR);
const filesIn = (dir: string): string[] => {
  try {
    return readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return statSync(p).isDirectory() ? filesIn(p) : [p]; });
  } catch {
    return [];
  }
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await sleep(25);
  return check();
}

type LoginOpts = { ip?: string; device?: string; remember?: boolean; app?: FastifyInstance };
async function signIn(email: string, password: string, o: LoginOpts = {}) {
  const a = o.app ?? await getApp();
  return a.inject({
    method: 'POST', url: '/api/auth/login', payload: { email, password, remember: !!o.remember },
    remoteAddress: o.ip ?? '127.0.0.1', ...(o.device && { cookies: { mlaz_dev: o.device } }),
  });
}
const cookie = (res: { cookies: { name: string; value: string; maxAge?: number }[] }, name: string) => res.cookies.find(c => c.name === name);
const latestCode = async (to: string) => {
  const n = await prisma.notification.findFirst({ where: { to, subject: 'Your MLAZ sign-in code' }, orderBy: { createdAt: 'desc' } });
  return /sign-in code is (\d{6})/.exec(n?.body ?? '')?.[1] ?? '';
};
const completeMfa = async (mfaToken: string, code: string) =>
  (await getApp()).inject({ method: 'POST', url: '/api/auth/login/mfa', payload: { mfaToken, code } });
/** Six addresses, five wrong passwords each: enough to have locked the account under the old rules. */
async function distributedAttack(email: string, net: string) {
  for (let ip = 1; ip <= 6; ip++) {
    for (let i = 0; i < 5; i++) expect((await signIn(email, 'wrong-password', { ip: `${net}.${ip}` })).statusCode).toBe(401);
  }
}

/* ================= R1: distributed account lock-out ================= */

describe('R1: sign-in throttling cannot be turned against the account owner', () => {
  beforeAll(resetDb);

  it('lets the real user in after a distributed attack: with an emailed code on a new device', async () => {
    await distributedAttack(STAFF.finance, '10.20.0');
    const step1 = await signIn(STAFF.finance, PASSWORD, { ip: '10.20.9.9' });
    expect(step1.statusCode).toBe(200);
    expect(step1.json()).toMatchObject({ mfaRequired: true, method: 'email' });
    expect(cookie(step1, 'mlaz_rt')).toBeUndefined(); // no session until the code is given

    const ok = await completeMfa(step1.json().mfaToken, await latestCode(STAFF.finance));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();
    expect(cookie(ok, 'mlaz_dev')?.value).toMatch(/^v1\./); // this device is now recognised
    await sleep(100); // the audit note is written off the request path
    expect(await prisma.auditLog.count({ where: { action: 'Sign-in protection switched on' } })).toBeGreaterThan(0);
  });

  it('lets a device that signed in before straight in, with no code, while the attack goes on', async () => {
    const first = await signIn(STAFF.comms, PASSWORD, { ip: '10.21.9.1' });
    const device = cookie(first, 'mlaz_dev')!.value;
    await distributedAttack(STAFF.comms, '10.21.0');
    const res = await signIn(STAFF.comms, PASSWORD, { ip: '10.21.9.2', device });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
    // A tampered device cookie earns nothing.
    const forged = await signIn(STAFF.comms, PASSWORD, { ip: '10.21.9.3', device: device.replace(/.$/, c => (c === 'A' ? 'B' : 'A')) });
    expect(forged.json()).toMatchObject({ mfaRequired: true, method: 'email' });
  });

  it('burns an emailed code after five wrong tries', async () => {
    const step1 = await signIn(STAFF.finance, PASSWORD, { ip: '10.20.9.10' });
    const { mfaToken } = step1.json();
    const code = await latestCode(STAFF.finance);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < LIMITS.code; i++) expect((await completeMfa(mfaToken, wrong)).json().error.code).toBe('INVALID_CODE');
    const late = await completeMfa(mfaToken, code);
    expect(late.statusCode).toBe(401);
    expect(late.json().error.code).toBe('CODE_EXPIRED');
  });

  it('blocks one address after 5 wrong passwords, longer each time, without affecting other addresses', async () => {
    for (let i = 0; i < LIMITS.source; i++) expect((await signIn(STAFF.officer, 'wrong-password', { ip: '10.30.0.1' })).statusCode).toBe(401);
    const blocked = await signIn(STAFF.officer, PASSWORD, { ip: '10.30.0.1' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await signIn(STAFF.officer, PASSWORD, { ip: '10.30.0.2' })).statusCode).toBe(200);

    // The first block lasts about a minute; once it is over, the next one lasts about four.
    const [row] = await prisma.loginThrottle.findMany({ where: { key: { startsWith: 'login:' }, strikes: 1 } });
    expect((row.lockedUntil!.getTime() - Date.now()) / 60e3).toBeLessThanOrEqual(1);
    await prisma.loginThrottle.update({ where: { key: row.key }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    for (let i = 0; i < LIMITS.source; i++) expect((await signIn(STAFF.officer, 'wrong-password', { ip: '10.30.0.1' })).statusCode).toBe(401);
    expect((await signIn(STAFF.officer, PASSWORD, { ip: '10.30.0.1' })).statusCode).toBe(429);
    const second = await prisma.loginThrottle.findUniqueOrThrow({ where: { key: row.key } });
    expect(second.strikes).toBe(2);
    expect((second.lockedUntil!.getTime() - Date.now()) / 60e3).toBeGreaterThan(3);
  });

  it('stops one address spraying a password over many accounts', async () => {
    for (let i = 0; i < LIMITS.address; i++) expect((await signIn(`spray${i}@example.zm`, 'Summer2026!', { ip: '10.40.0.1' })).statusCode).toBe(401);
    expect((await signIn('spray-next@example.zm', 'Summer2026!', { ip: '10.40.0.1' })).statusCode).toBe(429);
  });

  it('treats an unknown email exactly like a real one, so throttling reveals nothing', async () => {
    await distributedAttack('ghost@example.zm', '10.50.0');
    const unknown = await signIn('ghost@example.zm', PASSWORD, { ip: '10.50.9.9' });
    const known = await signIn(STAFF.admin, 'wrong-password', { ip: '10.50.9.9' });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(known.json());
    for (let i = 1; i < LIMITS.source; i++) await signIn('ghost@example.zm', 'x', { ip: '10.50.9.9' });
    expect((await signIn('ghost@example.zm', 'x', { ip: '10.50.9.9' })).statusCode).toBe(429);
    // Both paths verify a password hash, so neither answers noticeably faster.
    const time = async (email: string, n = 4) => {
      let t = 0;
      for (let i = 0; i < n; i++) { const s = performance.now(); await signIn(email, 'wrong-password', { ip: `10.51.${i}.${email.length}` }); t += performance.now() - s; }
      return t / n;
    };
    const [a, b] = [await time('nobody-at-all@example.zm'), await time(STAFF.admin)];
    expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(2);
  });

  it('cannot be dodged by changing the case or spacing of the email', async () => {
    const variants = ['Admin@MLAZ.org.zm', ' ADMIN@mlaz.org.zm', 'admin@Mlaz.Org.Zm ', 'aDmIn@mlaz.org.zm', 'admin@mlaz.org.zm'];
    for (const v of variants) expect((await signIn(v, 'wrong-password', { ip: '10.60.0.1' })).statusCode).toBe(401);
    expect((await signIn('ADMIN@MLAZ.ORG.ZM', PASSWORD, { ip: '10.60.0.1' })).statusCode).toBe(429);
  });

  it('counts parallel attempts exactly: 20 at once get 5 answers and 15 blocks', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => signIn(STAFF.officer, 'wrong-password', { ip: '10.70.0.1' })));
    const codes = results.map(r => r.statusCode);
    expect(codes.filter(c => c === 401)).toHaveLength(LIMITS.source);
    expect(codes.filter(c => c === 429)).toHaveLength(20 - LIMITS.source);
  });

  it('shares the counters between API instances', async () => {
    const other = await buildApp();
    try {
      for (let i = 0; i < 3; i++) expect((await signIn(STAFF.admin, 'wrong-password', { ip: '10.80.0.1' })).statusCode).toBe(401);
      for (let i = 0; i < 2; i++) expect((await signIn(STAFF.admin, 'wrong-password', { ip: '10.80.0.1', app: other })).statusCode).toBe(401);
      expect((await signIn(STAFF.admin, PASSWORD, { ip: '10.80.0.1', app: other })).statusCode).toBe(429);
    } finally {
      await other.close();
    }
  });

  it('lifts the protection once the owner resets their password', async () => {
    const m = await makeMember();
    await distributedAttack(m.email, '10.90.0');
    expect((await signIn(m.email, PASSWORD, { ip: '10.90.9.1' })).json().method).toBe('email');
    await (await getApp()).inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: m.email } });
    const token = await tokenFromEmail(m.email);
    expect((await (await getApp()).inject({ method: 'POST', url: '/api/auth/password/set', payload: { token, password: 'Recovered#Pass2026' } })).statusCode).toBe(200);
    const res = await signIn(m.email, 'Recovered#Pass2026', { ip: '10.90.9.2' });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
  });

  it('caps reset emails per account, so requests from many addresses cannot flood the owner or kill their link', async () => {
    const m = await makeMember();
    const forgot = async (email: string, ip: string) =>
      (await getApp()).inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email }, remoteAddress: ip });
    for (let i = 0; i < LIMITS.resetEmails; i++) expect((await forgot(m.email, `10.91.0.${i + 1}`)).statusCode).toBe(204);
    const owners = await tokenFromEmail(m.email);
    for (let i = 0; i < 3; i++) expect((await forgot(m.email, `10.91.1.${i + 1}`)).statusCode).toBe(204); // same answer
    expect(await prisma.notification.count({ where: { to: m.email, subject: { contains: 'Reset' } } })).toBe(LIMITS.resetEmails);
    const set = await (await getApp()).inject({ method: 'POST', url: '/api/auth/password/set', payload: { token: owners, password: 'Owner#Reset2026' } });
    expect(set.statusCode).toBe(200);
  });

  it('caps emailed sign-in codes per account, and the last code sent keeps working', async () => {
    const m = await makeMember();
    await distributedAttack(m.email, '10.92.0');
    let last = '';
    for (let i = 0; i < LIMITS.signInCodes; i++) {
      const res = await signIn(m.email, PASSWORD, { ip: `10.92.9.${i + 1}` });
      expect(res.json()).toMatchObject({ mfaRequired: true, method: 'email' });
      last = res.json().mfaToken;
    }
    const over = await signIn(m.email, PASSWORD, { ip: '10.92.9.99' });
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('TOO_MANY_CODES');
    expect(await prisma.notification.count({ where: { to: m.email, subject: 'Your MLAZ sign-in code' } })).toBe(LIMITS.signInCodes);
    const ok = await completeMfa(last, await latestCode(m.email));
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('never prints an emailed sign-in code in the log', () => {
    const line = logLineFor('email', 'x@example.zm', 'Dear X,\n\nYour sign-in code is 482913. It is valid for 10 minutes.');
    expect(line).not.toContain('482913');
    expect(line).toContain('[redacted]');
  });
});

/* ================= R3: absolute session lifetime ================= */

describe('R3: sessions end at a fixed deadline however often they are refreshed', () => {
  beforeAll(resetDb);

  async function signedIn(email: string = STAFF.officer, o: LoginOpts = {}) {
    const res = await signIn(email, PASSWORD, o);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { accessToken: string; sessionExpiresAt: string };
    const sid = (jwt.decode(body.accessToken) as { sid: string }).sid;
    return { ...body, refreshToken: cookie(res, 'mlaz_rt')!.value, sid, res };
  }
  const me = async (token: string) => (await getApp()).inject({ url: '/api/auth/me', headers: bearer(token) });

  it('refreshes normally, rotating the token but keeping the deadline set at sign-in', async () => {
    const s = await signedIn(STAFF.officer, { remember: true });
    const deadline = (await prisma.authSession.findUniqueOrThrow({ where: { id: s.sid } })).expiresAt;
    expect(deadline.getTime() - Date.now()).toBeLessThanOrEqual(config.SESSION_ABSOLUTE_LIFETIME_HOURS * 3600e3);
    // "Keep me signed in" keeps the cookie no longer than the session.
    expect(cookie(s.res, 'mlaz_rt')!.maxAge).toBeLessThanOrEqual(config.SESSION_ABSOLUTE_LIFETIME_HOURS * 3600);

    let token = s.refreshToken;
    for (let i = 0; i < 5; i++) {
      const r = await refreshWith(token);
      expect(r.statusCode, r.body).toBe(200);
      token = cookie(r, 'mlaz_rt')!.value;
      expect(new Date(r.json().sessionExpiresAt).getTime()).toBe(deadline.getTime());
      expect((jwt.decode(r.json().accessToken) as { sid: string }).sid).toBe(s.sid);
    }
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: s.sid } })).expiresAt.getTime()).toBe(deadline.getTime());
    for (const t of await prisma.refreshToken.findMany({ where: { sessionId: s.sid } })) expect(t.expiresAt.getTime()).toBeLessThanOrEqual(deadline.getTime());
    expect(await prisma.refreshToken.count({ where: { sessionId: s.sid, revokedAt: null } })).toBe(1);
  });

  it('refuses a refresh after the idle timeout', async () => {
    const s = await signedIn();
    await prisma.refreshToken.updateMany({ where: { sessionId: s.sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refreshWith(s.refreshToken)).statusCode).toBe(401);
  });

  it('refuses a refresh, and the access token, after the absolute deadline even if the refresh token is still valid', async () => {
    const s = await signedIn();
    expect((await me(s.accessToken)).statusCode).toBe(200);
    await prisma.authSession.update({ where: { id: s.sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me(s.accessToken)).statusCode).toBe(401);
    expect((await refreshWith(s.refreshToken)).statusCode).toBe(401);
  });

  it('cannot be stretched by refreshing near the deadline: every token is capped at it', async () => {
    const s = await signedIn();
    const soon = new Date(Date.now() + 90_000);
    await prisma.authSession.update({ where: { id: s.sid }, data: { expiresAt: soon } });
    const r = await refreshWith(s.refreshToken);
    expect(r.statusCode).toBe(200);
    const next = await prisma.refreshToken.findFirstOrThrow({ where: { sessionId: s.sid, revokedAt: null } });
    expect(next.expiresAt.getTime()).toBeLessThanOrEqual(soon.getTime());
    expect((jwt.decode(r.json().accessToken) as { exp: number }).exp * 1000).toBeLessThanOrEqual(soon.getTime() + 1000);
    expect(r.json().expiresIn).toBeLessThanOrEqual(90);
  });

  it('applies a lowered lifetime to sessions that already exist', async () => {
    const s = await signedIn();
    // Signed in longer ago than the configured lifetime allows, even though the stored deadline is later.
    await prisma.authSession.update({ where: { id: s.sid }, data: { createdAt: new Date(Date.now() - (config.SESSION_ABSOLUTE_LIFETIME_HOURS * 3600e3 + 60e3)), expiresAt: new Date(Date.now() + 864e5) } });
    expect((await refreshWith(s.refreshToken)).statusCode).toBe(401);
    expect((await me(s.accessToken)).statusCode).toBe(401);
  });

  it('treats reuse of a rotated token as theft and ends every session', async () => {
    const a = await signedIn(STAFF.comms), b = await signedIn(STAFF.comms);
    const r = await refreshWith(a.refreshToken);
    expect(r.statusCode).toBe(200);
    expect((await refreshWith(a.refreshToken)).statusCode).toBe(401); // replay of the old token
    expect((await refreshWith(cookie(r, 'mlaz_rt')!.value)).statusCode).toBe(401); // the new chain is dead too
    expect((await me(b.accessToken)).statusCode).toBe(401); // and so is every other session
    const u = await prisma.user.findUniqueOrThrow({ where: { email: STAFF.comms } });
    expect(await prisma.authSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
  });

  it('ends exactly the signed-out session at once, access token included', async () => {
    const a = await signedIn(STAFF.finance), b = await signedIn(STAFF.finance);
    const out = await (await getApp()).inject({ method: 'POST', url: '/api/auth/logout', headers: { 'x-mlaz-csrf': '1' }, cookies: { mlaz_rt: a.refreshToken } });
    expect(out.statusCode).toBe(204);
    expect((await me(a.accessToken)).statusCode).toBe(401);
    expect((await refreshWith(a.refreshToken)).statusCode).toBe(401);
    expect((await me(b.accessToken)).statusCode).toBe(200);
  });

  it('never lets parallel refreshes fork a session into two live chains', async () => {
    const s = await signedIn(STAFF.admin);
    const results = await Promise.all(Array.from({ length: 5 }, () => refreshWith(s.refreshToken)));
    expect(results.filter(r => r.statusCode === 200).length).toBeLessThanOrEqual(1);
    expect(await prisma.refreshToken.count({ where: { sessionId: s.sid, revokedAt: null } })).toBeLessThanOrEqual(1);
  });

  it('enforces the same rules on every API instance', async () => {
    const other = await buildApp();
    try {
      const s = await signedIn(STAFF.officer);
      const viaOther = await other.inject({ method: 'POST', url: '/api/auth/refresh', headers: { 'x-mlaz-csrf': '1' }, cookies: { mlaz_rt: s.refreshToken }, payload: {} });
      expect(viaOther.statusCode).toBe(200);
      expect((await refreshWith(s.refreshToken)).statusCode).toBe(401); // the reuse is seen by the first instance
      const t = await signedIn(STAFF.officer);
      await prisma.authSession.update({ where: { id: t.sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await other.inject({ url: '/api/auth/me', headers: bearer(t.accessToken) })).statusCode).toBe(401);
    } finally {
      await other.close();
    }
  });

  it('refuses access and refresh tokens from before sessions had a deadline', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: STAFF.officer } });
    const legacy = jwt.sign({ typ: 'access', role: u.role, ims: Date.now() }, config.JWT_SECRET, { subject: u.id, expiresIn: 600, issuer: 'mlaz-api', audience: 'mlaz-platform', algorithm: 'HS256' });
    expect((await me(legacy)).statusCode).toBe(401);
    await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: sha256('legacy-token-value-123'), expiresAt: new Date(Date.now() + 864e5) } });
    expect((await refreshWith('legacy-token-value-123')).statusCode).toBe(401);
  });

  it('refuses to start with an absolute lifetime shorter than the idle timeout', () => {
    const res = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/config.ts')"], {
      env: { ...process.env, SESSION_IDLE_TIMEOUT_HOURS: '48', SESSION_ABSOLUTE_LIFETIME_HOURS: '24' }, encoding: 'utf8', timeout: 60_000,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('SESSION_ABSOLUTE_LIFETIME_HOURS');
  });
});

/* ================= R2: uploads stream to disk ================= */

type Part = { field: string; filename: string; type?: string; size: number; head?: Buffer };
type Result = { status: number; body: string } | { error: string };

describe('R2: uploads are streamed, limited and cleaned up', () => {
  let port = 0, memberToken = '';
  let member: Awaited<ReturnType<typeof makeMember>>;
  const B = '----mlazPhase3Boundary';
  const filler = Buffer.alloc(64 * 1024, 0x20); // reused, so the client side holds one chunk at a time

  beforeAll(async () => {
    await resetDb();
    const app = await getApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    member = await makeMember();
    memberToken = (await login(member.email)).accessToken;
  });
  // Stop listening; the app itself stays up for inject() in later tests.
  afterAll(async () => { const s = (await getApp()).server; s.closeAllConnections(); await new Promise(r => s.close(r)); });

  /**
   * Sends a multipart upload over a real socket, streaming `size` bytes per file (the head, then filler). With
   * `stopAfter`, sending stops after that many file bytes: 'stall' keeps the connection open, 'abort' drops it.
   */
  function upload(url: string, fields: Record<string, string>, parts: Part[], o: { auth?: string | null; stopAfter?: number; mode?: 'stall' | 'abort'; contentLength?: number } = {}) {
    const heads = parts.map(p => Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${p.field}"; filename="${p.filename}"\r\nContent-Type: ${p.type ?? 'application/pdf'}\r\n\r\n`));
    const pre = Buffer.from(Object.entries(fields).map(([k, v]) => `--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join(''));
    const tail = Buffer.from(`--${B}--\r\n`);
    const total = pre.length + tail.length + parts.reduce((n, p, i) => n + heads[i].length + p.size + 2, 0);
    const auth = o.auth === undefined ? memberToken : o.auth;
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: `/api${url}`,
      headers: { 'content-type': `multipart/form-data; boundary=${B}`, 'content-length': o.contentLength ?? total, ...(auth && { authorization: `Bearer ${auth}` }) },
    });
    const response = new Promise<Result>(resolve => {
      req.on('response', res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode!, body })); });
      req.on('error', e => resolve({ error: (e as NodeJS.ErrnoException).code ?? e.message }));
    });
    const send = async () => {
      const write = async (b: Buffer) => {
        if (req.destroyed || req.write(b)) return;
        await new Promise<void>(resume => {
          const done = () => { req.off('drain', done); req.off('close', done); resume(); };
          req.on('drain', done); req.on('close', done);
        });
      };
      await write(pre);
      let sent = 0;
      for (const [i, p] of parts.entries()) {
        await write(heads[i]);
        let left = p.size;
        for (let chunk = p.head ?? Buffer.from('%PDF-1.4\n'); left > 0 && !req.destroyed; chunk = filler) {
          const piece = chunk.subarray(0, Math.min(chunk.length, left));
          if (o.stopAfter !== undefined && sent + piece.length > o.stopAfter) {
            if (o.mode === 'abort') req.destroy(); // the client gives up mid-file
            return; // or stalls with the connection open
          }
          await write(piece);
          sent += piece.length; left -= piece.length;
        }
        await write(Buffer.from('\r\n'));
      }
      if (!req.destroyed) req.end(tail);
    };
    void send().catch(() => {});
    return { response, req };
  }
  const json = (r: Result) => ('body' in r ? JSON.parse(r.body || '{}') : {});
  const status = (r: Result) => ('status' in r ? r.status : r.error);
  const renewal = (n: number, part: Partial<Part> = {}, o = {}) =>
    upload('/portal/mof-renewals', { mofRef: `MoF/ML/2027/${String(n).padStart(4, '0')}` }, [{ field: 'file', filename: 'renewal.pdf', size: 1000, ...part }], o);
  const clearRenewals = () => prisma.mofRenewal.deleteMany({ where: { memberId: member.id } });

  it('accepts a file within the limit, streams it into storage intact, and leaves no temporary file', async () => {
    const before = filesIn(STORAGE).length;
    const r = await renewal(101, { size: 3 * 1024 * 1024 }).response;
    expect(status(r), JSON.stringify(r)).toBe(201);
    expect(filesIn(STORAGE).length).toBe(before + 1);
    const doc = await prisma.document.findFirstOrThrow({ where: { memberId: member.id }, orderBy: { createdAt: 'desc' } });
    expect(doc.size).toBe(3 * 1024 * 1024);
    expect(statSync(path.join(STORAGE, doc.storageKey)).size).toBe(doc.size);
    expect(await until(() => filesIn(TMP).length === 0 && uploadStats().active === 0)).toBe(true);
    expect(uploadStats()).toEqual({ active: 0, tempBytes: 0 });
    await clearRenewals();
  });

  it('refuses a file over the size limit with 413, storing nothing', async () => {
    const before = filesIn(STORAGE).length;
    const r = await renewal(102, { filename: 'big.pdf', size: maxFileBytes() + 512 * 1024 }).response;
    expect(status(r)).toBe(413);
    expect(json(r).error.code).toBe('FST_REQ_FILE_TOO_LARGE');
    expect(filesIn(STORAGE).length).toBe(before);
    expect(await until(() => filesIn(TMP).length === 0)).toBe(true);
  });

  it('refuses a request whose declared size is too large before reading any of it', async () => {
    const { response, req } = renewal(103, {}, { contentLength: 500 * 1024 * 1024, stopAfter: 0, mode: 'stall' });
    const r = await response;
    req.destroy();
    expect(status(r)).toBe(413);
    expect(filesIn(TMP)).toHaveLength(0);
  });

  it('refuses content that is not PDF, JPG or PNG, whatever its name or declared type says', async () => {
    const fakes: Partial<Part>[] = [
      { filename: 'invoice.pdf', type: 'application/pdf', size: 2000, head: Buffer.from('<html><script>alert(1)</script>') },
      { filename: 'photo.png', type: 'image/png', size: 2000, head: Buffer.from('MZ\x90\x00\x03\x00\x00\x00') }, // a Windows executable
      { filename: 'logo.png', type: 'image/png', size: 2000, head: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">') },
    ];
    const before = filesIn(STORAGE).length;
    for (const f of fakes) expect(status(await renewal(104, f).response), f.filename).toBe(400);
    expect(filesIn(STORAGE).length).toBe(before);
    // A real PNG sent as "something.pdf" is accepted as what it is: stored as a PNG under a server-made name.
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a20000000049454e44ae426082', 'hex');
    expect(status(await renewal(105, { filename: 'something.pdf', type: 'application/pdf', size: png.length, head: png }).response)).toBe(201);
    const doc = await prisma.document.findFirstOrThrow({ where: { memberId: member.id }, orderBy: { createdAt: 'desc' } });
    expect(doc.mimeType).toBe('image/png');
    expect(doc.storageKey).toMatch(/^mof_authorization\/\d{4}\/[0-9a-f-]{36}\.png$/);
    expect(await until(() => filesIn(TMP).length === 0)).toBe(true);
    await clearRenewals();
  });

  it('ignores path tricks in file names: storage names are generated and nothing lands outside storage', async () => {
    for (const filename of ['../../../escape.pdf', '..\\\\..\\\\escape2.pdf', '/etc/passwd.pdf']) {
      expect(status(await renewal(106, { filename }).response), filename).toBe(201);
      const doc = await prisma.document.findFirstOrThrow({ where: { memberId: member.id }, orderBy: { createdAt: 'desc' } });
      expect(doc.storageKey).toMatch(/^mof_authorization\/\d{4}\/[0-9a-f-]{36}\.pdf$/);
      expect(doc.filename).not.toMatch(/[\\/]|^\./);
      await clearRenewals();
    }
    for (const p of ['escape.pdf', 'escape2.pdf']) {
      expect(existsSync(path.resolve(STORAGE, '..', p))).toBe(false);
      expect(existsSync(path.resolve(STORAGE, '..', '..', p))).toBe(false);
    }
    await expect(storage.put('../outside.pdf', PDF, 'application/pdf')).rejects.toThrow('Invalid storage key');
    await expect(storage.stream('../../package.json')).rejects.toThrow('Invalid storage key');
  });

  it('removes the partial file when the client drops the connection mid-upload', async () => {
    const before = filesIn(STORAGE).length;
    let peakTemp = 0;
    const sampler = setInterval(() => { peakTemp = Math.max(peakTemp, uploadStats().tempBytes); }, 1);
    const { response } = renewal(107, { size: 8 * 1024 * 1024 }, { stopAfter: 6 * 1024 * 1024, mode: 'abort' });
    await response;
    expect(await until(() => uploadStats().active === 0 && filesIn(TMP).length === 0)).toBe(true);
    clearInterval(sampler);
    expect(peakTemp).toBeGreaterThan(0); // it had been writing to disk before the client went away
    expect(uploadStats().tempBytes).toBe(0);
    expect(filesIn(STORAGE).length).toBe(before);
  });

  it('cuts off a stalled upload after the timeout and cleans up', async () => {
    const { response } = renewal(108, { size: 1024 * 1024 }, { stopAfter: 256 * 1024, mode: 'stall' });
    expect(await until(() => filesIn(TMP).length === 1, 2000)).toBe(true);
    const r = await response; // the server ends it after UPLOAD_TIMEOUT_SECONDS
    expect(typeof status(r) === 'string' || status(r) === 408).toBe(true);
    expect(await until(() => uploadStats().active === 0 && filesIn(TMP).length === 0)).toBe(true);
  }, 30_000);

  it('limits uploads in progress, and concurrent uploads do not pile up in memory', async () => {
    // Three applications with three 9.5 MB files each: 85 MB in flight. Held in memory, that would show in full.
    const size = Math.floor(9.5 * 1024 * 1024);
    const fields = (n: number) => ({
      name: `Stream Lenders ${n}`, pacra: String(120260008800 + n), tpin: String(1008888800 + n), town: 'Ndola', province: 'Copperbelt', address: 'Plot 9',
      tier: 'Silver', contact: 'Chanda Mwila', position: 'Director', phone: `09770088${String(n).padStart(2, '0')}`, email: `stream${n}@lenders.zm`,
      director: 'Chanda Mwila', directorNrc: '123456/78/1', declare: 'true', mofRef: `MoF/ML/2026/88${n}`,
    });
    const files = ['pacraFile', 'nrcFile', 'mofFile'].map(field => ({ field, filename: `${field}.pdf`, size }));
    // Collect garbage before each sample, so what is measured is memory actually held, not chunks awaiting collection.
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const live = () => { gc(); const m = process.memoryUsage(); return m.arrayBuffers + m.heapUsed; };
    const baseline = live();
    let peak = 0, peakTemp = 0;
    const sampler = setInterval(() => {
      peak = Math.max(peak, live() - baseline);
      peakTemp = Math.max(peakTemp, uploadStats().tempBytes);
    }, 100);
    const runs = [1, 2, 3].map(n => upload('/public/applications', fields(n), files, { auth: null }));
    // All slots are taken while they stream, so a further upload is turned away.
    expect(await until(() => uploadStats().active === config.UPLOAD_MAX_CONCURRENT, 3000)).toBe(true);
    const extra = await renewal(109).response;
    expect(status(extra)).toBe(503);
    expect(json(extra).error.code).toBe('UPLOADS_BUSY');
    const results = await Promise.all(runs.map(r => r.response));
    clearInterval(sampler);
    expect(results.map(status)).toEqual([201, 201, 201]);
    expect(peakTemp).toBeGreaterThan(20 * 1024 * 1024); // the data went to disk…
    console.info(`concurrent uploads: peak live memory +${(peak / 1048576).toFixed(1)} MB, peak temp files ${(peakTemp / 1048576).toFixed(1)} MB (85 MB uploaded)`);
    expect(peak).toBeLessThan(25 * 1024 * 1024); // …not into memory (85 MB were uploaded)
    expect(await until(() => filesIn(TMP).length === 0)).toBe(true);
  }, 60_000);

  it('refuses uploads and document downloads to anyone not entitled to them', async () => {
    expect(status(await renewal(110, {}, { auth: null }).response)).toBe(401);
    expect(status(await renewal(111, {}, { auth: 'not-a-token' }).response)).toBe(401);
    expect(filesIn(TMP)).toHaveLength(0);

    const other = await makeMember();
    const otherToken = (await login(other.email)).accessToken;
    const doc = await prisma.document.findFirstOrThrow({ where: { memberId: member.id } });
    const a = await getApp();
    expect((await a.inject({ url: `/api/portal/documents/${doc.id}`, headers: bearer(otherToken) })).statusCode).toBe(404);
    expect((await a.inject({ url: `/api/portal/documents/${doc.id}` })).statusCode).toBe(401);
    expect((await a.inject({ url: `/api/admin/documents/${doc.id}`, headers: bearer(otherToken) })).statusCode).toBe(403);
    const own = await a.inject({ url: `/api/portal/documents/${doc.id}`, headers: bearer(memberToken) });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-length']).toBe(String(doc.size));
    expect(own.headers['content-disposition']).toMatch(/^attachment;/);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(own.rawPayload.length).toBe(doc.size);
  });

  it('never serves stored or temporary files as static content', async () => {
    const doc = await prisma.document.findFirstOrThrow({ where: { memberId: member.id } });
    const a = await getApp();
    for (const url of [`/${doc.storageKey}`, `/storage/${doc.storageKey}`, `/storage-test/${doc.storageKey}`, `/api/${doc.storageKey}`, '/upload-tmp-test/', '/storage-test/', `/api/public/../../storage-test/${doc.storageKey}`]) {
      const res = await a.inject({ url });
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toContain('%PDF');
    }
  });
});

/* ================= R4: Content-Security-Policy (API side) ================= */

describe('R4: the API sends a strict CSP and accepts violation reports', () => {
  it('sends a CSP with no inline script on API responses', async () => {
    const res = await (await getApp()).inject({ url: '/api/public/config' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(/script-src ([^;]*)/.exec(csp)?.[1] ?? '').not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('accepts CSP violation reports in both formats and answers 204', async () => {
    const a = await getApp();
    const legacy = await a.inject({ method: 'POST', url: '/api/csp-report', headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ 'csp-report': { 'document-uri': 'https://app.mlaz.org.zm/#/track/APP-1?t=secret', 'effective-directive': 'script-src-attr', 'blocked-uri': 'inline' } }) });
    expect(legacy.statusCode).toBe(204);
    const modern = await a.inject({ method: 'POST', url: '/api/csp-report', headers: { 'content-type': 'application/reports+json' },
      payload: JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://app.mlaz.org.zm/?token=abc', effectiveDirective: 'script-src-elem', blockedURL: 'https://evil.example/x.js?c=1' } }]) });
    expect(modern.statusCode).toBe(204);
    const junk = await a.inject({ method: 'POST', url: '/api/csp-report', headers: { 'content-type': 'application/csp-report' }, payload: 'not json' });
    expect(junk.statusCode).toBe(204);
  });
});

/* ================= housekeeping ================= */

describe('nightly pruning of sign-in records', () => {
  beforeAll(resetDb);

  it('deletes expired sessions, codes and idle counters, and keeps anything still in force', async () => {
    const { pruneAuthRecords } = await import('../src/jobs/runner.js');
    const u = await prisma.user.findUniqueOrThrow({ where: { email: STAFF.officer } });
    const old = new Date(Date.now() - 40 * 864e5), soon = new Date(Date.now() + 864e5);
    const dead = await prisma.authSession.create({ data: { userId: u.id, createdAt: old, expiresAt: old } });
    await prisma.refreshToken.create({ data: { userId: u.id, sessionId: dead.id, tokenHash: sha256('dead-session-token'), expiresAt: old } });
    const live = await prisma.authSession.create({ data: { userId: u.id, expiresAt: soon } });
    await prisma.loginThrottle.createMany({ data: [
      { key: 'test:idle', windowStart: old },
      { key: 'test:blocked', windowStart: old, lockedUntil: soon }, // a block still in force is kept
    ] });
    const r = await pruneAuthRecords();
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect(await prisma.authSession.findUnique({ where: { id: dead.id } })).toBeNull();
    expect(await prisma.refreshToken.count({ where: { sessionId: dead.id } })).toBe(0);
    expect(await prisma.authSession.findUnique({ where: { id: live.id } })).not.toBeNull();
    expect(await prisma.loginThrottle.findUnique({ where: { key: 'test:idle' } })).toBeNull();
    expect(await prisma.loginThrottle.findUnique({ where: { key: 'test:blocked' } })).not.toBeNull();
  });
});

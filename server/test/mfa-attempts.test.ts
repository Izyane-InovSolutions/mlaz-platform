// Authenticator-code attempt counting (identity/domain/throttle-policy.ts). Replay prevention stays per user (a code
// belongs to the user's secret); the attempt counters are per sign-in step, per account from unrecognised devices,
// per recognised device and per session, so guessing cannot lock the owner out and a sign-in step is used once.
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentStep, totpAt } from '../src/modules/identity/domain/totp.js';
import { PASSWORD, STAFF, bearer, getApp, resetDb } from './helpers.js';

let secret = '';
let recovery: string[] = [];

const inject = async (o: InjectOptions) => (await getApp()).inject(o);
const startSignIn = async (device?: string) => (await inject({
  method: 'POST', url: '/api/auth/login', payload: { email: STAFF.admin, password: PASSWORD }, ...(device && { cookies: { mlaz_dev: device } }),
})).json().mfaToken as string;
const finish = (mfaToken: string, code: string, device?: string) =>
  inject({ method: 'POST', url: '/api/auth/login/mfa', payload: { mfaToken, code }, ...(device && { cookies: { mlaz_dev: device } }) });
const deviceCookie = (res: LightMyRequestResponse) => res.cookies.find(c => c.name === 'mlaz_dev')?.value ?? '';
const nextCode = () => totpAt(secret, currentStep() + 1); // the enrolment used the current step; +1 is within the drift window

beforeEach(async () => {
  await resetDb();
  const login = (await inject({ method: 'POST', url: '/api/auth/login', payload: { email: STAFF.admin, password: PASSWORD } })).json();
  const auth = bearer(login.accessToken);
  secret = (await inject({ method: 'POST', url: '/api/auth/mfa/setup', headers: auth })).json().secret;
  const confirmed = await inject({ method: 'POST', url: '/api/auth/mfa/confirm', headers: auth, payload: { code: totpAt(secret, currentStep()) } });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  recovery = confirmed.json().recoveryCodes;
});

describe('authenticator codes: attempt counting', () => {
  it('a completed sign-in step cannot be completed again', async () => {
    const token = await startSignIn();
    expect((await finish(token, recovery[0])).statusCode).toBe(200);
    const again = await finish(token, recovery[1]);
    expect(again.statusCode).toBe(401);
    expect(again.json().error.message).toMatch(/sign-in step expired/);
  });

  it('five wrong codes use up a sign-in step, even before the right one arrives', async () => {
    const token = await startSignIn();
    for (let i = 0; i < 5; i++) expect((await finish(token, '000000')).json().error.code).toBe('INVALID_CODE');
    const late = await finish(token, recovery[0]);
    expect(late.statusCode).toBe(401);
    expect(late.json().error.message).toMatch(/sign-in step expired/);
  });

  it('guessing from unrecognised devices cannot lock the owner out of a recognised one, and the account ceiling stays', async () => {
    const owner = await finish(await startSignIn(), recovery[0]);
    const device = deviceCookie(owner);
    expect(device).not.toBe('');
    // Someone with the password guesses across fresh sign-in steps from elsewhere until the account ceiling blocks them.
    let blocked = false;
    for (let i = 0; i < 8 && !blocked; i++) {
      const r = await finish(await startSignIn(), '000000');
      blocked = r.statusCode === 429;
    }
    expect(blocked).toBe(true);
    expect((await finish(await startSignIn(), recovery[1])).statusCode).toBe(429); // the ceiling holds for unrecognised devices
    // The owner's browser is counted on its own and signs in as normal.
    const ok = await finish(await startSignIn(device), recovery[2], device);
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('guessing in one session blocks only that session, not another session or the second factor at sign-in', async () => {
    const a = bearer((await finish(await startSignIn(), recovery[0])).json().accessToken);
    const b = bearer((await finish(await startSignIn(), recovery[1])).json().accessToken);
    const regenerate = (headers: Record<string, string>, code: string) => inject({ method: 'POST', url: '/api/auth/mfa/recovery-codes', headers, payload: { code } });
    for (let i = 0; i < 5; i++) expect((await regenerate(a, '000000')).statusCode).toBe(400);
    expect((await regenerate(a, nextCode())).statusCode).toBe(429);
    const fresh = await regenerate(b, nextCode());
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect((await finish(await startSignIn(), fresh.json().recoveryCodes[0])).statusCode).toBe(200);
  });

  it('a code is still refused everywhere once used: replay prevention is per user', async () => {
    const a = bearer((await finish(await startSignIn(), recovery[0])).json().accessToken);
    const code = nextCode();
    expect((await inject({ method: 'POST', url: '/api/auth/mfa/recovery-codes', headers: a, payload: { code } })).statusCode).toBe(200);
    expect((await finish(await startSignIn(), code)).json().error.code).toBe('INVALID_CODE');
  });

  it('two valid codes sent at once on the same sign-in step give exactly one session', async () => {
    const token = await startSignIn();
    const results = await Promise.all([finish(token, recovery[0]), finish(token, recovery[1]), finish(token, nextCode())]);
    expect(results.filter(r => r.statusCode === 200)).toHaveLength(1);
  });
});

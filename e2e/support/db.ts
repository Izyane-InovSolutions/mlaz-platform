// Direct reads of mlaz_e2e for assertions and for the links the API emails (see seed.ts for e2e_mail).
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { API_ENV, DATABASE_URL } from './env.ts';

let pool: pg.Pool | null = null;
const db = () => (pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 }));

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await db().query<T>(sql, params)).rows;
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}

/**
 * Waits for an email to `to` whose body matches `pattern`, and returns the first capture group (or the match), from the
 * newest such email. `afterId` (see lastMailId) skips emails captured before a step, so an older one is never taken.
 */
export async function mailLink(to: string, pattern: RegExp, { after = new Date(0), afterId = 0 } = {}) {
  let found: string | null = null;
  await expect.poll(async () => {
    const rows = await query<{ body: string }>(`SELECT body FROM e2e_mail WHERE "to" = $1 AND channel = 'EMAIL' AND created_at >= $2 AND id > $3 ORDER BY id DESC`, [to, after, afterId]);
    for (const r of rows) {
      const m = r.body.match(pattern);
      if (m) { found = m[1] ?? m[0]; return true; }
    }
    return false;
  }, { message: `an email to ${to} matching ${pattern}`, timeout: 15_000 }).toBe(true);
  return found as unknown as string;
}

/** The id of the newest captured email (0 if none), to pass as mailLink's afterId. */
export const lastMailId = async () => (await query<{ id: number }>('SELECT COALESCE(max(id), 0)::int AS id FROM e2e_mail'))[0].id;

/** The set-password link (invite or reset) in the newest email to `to`, as a path for page.goto. */
export const setPasswordLink = (to: string) => mailLink(to, /http:\/\/[^\s]+(\/#\/set-password\?token=[\w-]+)/);
/** The tracking link in the application confirmation email, as a path for page.goto. */
export const trackingLink = (to: string) => mailLink(to, /http:\/\/[^\s]+(\/#\/track\/APP-\d+\?t=[\w-]+)/);

export async function paymentStatus(ref: string) {
  const [p] = await query<{ status: string }>('SELECT status FROM "Payment" WHERE ref = $1', [ref]);
  return p?.status ?? null;
}

let clones = 0;
/**
 * A new member (and portal user, same password) copied from a fixture member, with its own number, email and name,
 * dues payable in `dueInDays`. For tests that change a member's dues: copies running in parallel (other workers,
 * --repeat-each) never share one. Columns are copied generically, so schema changes do not break it.
 */
export async function cloneMember(templateNumber: string, label: string, dueInDays: number) {
  const n = `${Date.now() % 1e5}${++clones}${process.pid % 10}`.slice(-6);
  const number = `MLA-7${n}`, email = `${label.toLowerCase()}.${n}@e2e-lender.zm`, name = `${label} Lenders ${n}`;
  const [m] = await query<{ id: string }>(
    `INSERT INTO "Member" SELECT (jsonb_populate_record(NULL::"Member", to_jsonb(m) || jsonb_build_object(
       'id', gen_random_uuid(), 'number', $2::text, 'name', $3::text, 'contactEmail', $4::text, 'applicationId', NULL,
       'validUntil', CURRENT_DATE + $5::int, 'createdAt', now(), 'updatedAt', now()))).* FROM "Member" m WHERE m.number = $1 RETURNING id`,
    [templateNumber, number, name, email, dueInDays]);
  await query(
    `INSERT INTO "User" SELECT (jsonb_populate_record(NULL::"User", to_jsonb(u) || jsonb_build_object(
       'id', gen_random_uuid(), 'email', $2::text, 'memberId', $3::text, 'createdAt', now(), 'updatedAt', now()))).*
     FROM "User" u JOIN "Member" m ON m.id = u."memberId" WHERE m.number = $1 LIMIT 1`,
    [templateNumber, email, m.id]);
  return { number, email, name };
}

/* ---------- Simulated passage of time (the API has no clock control) ---------- */
// Test-only helpers that move one session's timestamps into the past, as if hours had gone by. The session is found
// from the browser's refresh cookie (the API stores only its SHA-256), so other sessions of the same user are untouched.
// Prisma stores these as UTC timestamps without a zone, hence now() AT TIME ZONE 'UTC'. Which columns decide expiry (server/src/modules/identity/application/sessions.ts and authenticate.ts):
//  - idle: RefreshToken.expiresAt, set to (last refresh + SESSION_IDLE_TIMEOUT_HOURS) at each refresh, checked by
//    POST /auth/refresh only. Access tokens are short-lived JWTs, so after a real idle period the page has none left;
//  - absolute: AuthSession.expiresAt, capped at AuthSession.createdAt + SESSION_ABSOLUTE_LIFETIME_HOURS, checked on
//    every request (access token) and every refresh.
const HOURS = { idle: Number(API_ENV.SESSION_IDLE_TIMEOUT_HOURS), absolute: Number(API_ENV.SESSION_ABSOLUTE_LIFETIME_HOURS) };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function sessionIdFor(refreshCookie: string) {
  const [row] = await query<{ sessionId: string }>('SELECT "sessionId" FROM "RefreshToken" WHERE "tokenHash" = $1 AND "revokedAt" IS NULL', [sha256(refreshCookie)]);
  expect(row?.sessionId, 'a live session for this refresh cookie').toBeTruthy();
  return row.sessionId;
}

/**
 * As if the browser had been left idle for longer than SESSION_IDLE_TIMEOUT_HOURS: every timestamp of the session
 * (sign-in, last use, absolute deadline, refresh token's idle deadline) moves back by the idle timeout plus an hour.
 * The absolute deadline stays in the future, so only the idle timeout has passed.
 */
export async function ageSessionPastIdleTimeout(refreshCookie: string) {
  const id = await sessionIdFor(refreshCookie), shift = HOURS.idle + 1;
  await query(`UPDATE "AuthSession" SET "createdAt" = "createdAt" - make_interval(hours => $2), "lastUsedAt" = "lastUsedAt" - make_interval(hours => $2),
     "expiresAt" = "expiresAt" - make_interval(hours => $2) WHERE id = $1`, [id, shift]);
  await query('UPDATE "RefreshToken" SET "expiresAt" = "expiresAt" - make_interval(hours => $2) WHERE "sessionId" = $1', [id, shift]);
  const [s] = await query<{ idleOver: boolean; absoluteOver: boolean }>(
    `SELECT bool_and(r."expiresAt" < (now() AT TIME ZONE 'UTC')) AS "idleOver", bool_or(s."expiresAt" < (now() AT TIME ZONE 'UTC')) AS "absoluteOver"
     FROM "AuthSession" s JOIN "RefreshToken" r ON r."sessionId" = s.id WHERE s.id = $1`, [id]);
  expect(s).toEqual({ idleOver: true, absoluteOver: false });
}

/**
 * As if the session had been in use, refreshed regularly, for longer than SESSION_ABSOLUTE_LIFETIME_HOURS: the
 * sign-in time and the absolute deadline move back by the lifetime plus an hour. The refresh token keeps its idle
 * deadline (it was "just refreshed"), so the absolute deadline is the only thing that has passed.
 */
export async function ageSessionPastAbsoluteLifetime(refreshCookie: string) {
  const id = await sessionIdFor(refreshCookie), shift = HOURS.absolute + 1;
  await query(`UPDATE "AuthSession" SET "createdAt" = "createdAt" - make_interval(hours => $2), "expiresAt" = "expiresAt" - make_interval(hours => $2),
     "lastUsedAt" = (now() AT TIME ZONE 'UTC') WHERE id = $1`, [id, shift]);
  const [s] = await query<{ idleOver: boolean; absoluteOver: boolean }>(
    `SELECT bool_or(r."expiresAt" < (now() AT TIME ZONE 'UTC')) FILTER (WHERE r."revokedAt" IS NULL) AS "idleOver", bool_and(s."expiresAt" < (now() AT TIME ZONE 'UTC')) AS "absoluteOver"
     FROM "AuthSession" s JOIN "RefreshToken" r ON r."sessionId" = s.id WHERE s.id = $1`, [id]);
  expect(s).toEqual({ idleOver: false, absoluteOver: true });
}

/* ---------- Sign-in protection ---------- */
/**
 * Adds failed sign-ins "from other addresses" to the account's counter of failures from unrecognised devices (the
 * LoginThrottle row keyed account:<sha256(email)>, see server/src/modules/identity/domain/throttle-policy.ts). Every
 * browser test signs in from 127.0.0.1, and the per-address limit (5) stops a single address long before the
 * per-account one (10), so the failures from elsewhere are simulated here. The row is the one the API's own failed
 * attempts already created; this only raises its count.
 */
export async function addFailedSignInsFromElsewhere(email: string, failures: number) {
  const rows = await query('UPDATE "LoginThrottle" SET failures = failures + $2 WHERE key = $1 RETURNING failures', [`account:${sha256(email.trim().toLowerCase())}`, failures]);
  expect(rows, 'the account has failed sign-ins recorded by the API').toHaveLength(1);
}

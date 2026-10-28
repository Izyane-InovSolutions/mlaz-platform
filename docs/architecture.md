# MLAZ Platform: Architecture

Node.js 22+ · TypeScript · Fastify 5 · Prisma 7 · PostgreSQL 17 · vanilla-JS UI built with Vite

Two npm projects in one repository:

| Project | Folder | What it is |
| --- | --- | --- |
| UI | `/` (`src/`, `index.html`) | Static site deployed to Vercel. Public site, member portal, Secretariat console. Talks to the API only. |
| API | `server/` | One Fastify process: HTTP API plus in-process background jobs. Deployed separately. |

The API is a **modular monolith**: one deployable, one database, with modules separated by folder and by enforced
import rules. Nothing in the current load or team size justifies splitting it into services.

Quality and security tooling (lint, format, tests, CI, pre-push hook, dependency audit, secret scan) is described in
[QUALITY_CHECKS.md](QUALITY_CHECKS.md).

---

## API folder layout

```
server/
  src/
    index.ts        Entry point: build app -> listen -> start jobs. Graceful shutdown and process-level error handling.
    app.ts          Fastify instance: plugins, global hooks, error handler, health probes, request ids, route mounting.
    config.ts       Zod-validated environment. Exits on invalid config; productionProblems() blocks unsafe production starts.
    lib/            Framework-light building blocks with no business rules: db client, auth tokens and guards, errors,
                    validation, uploads, storage, crypto, dates, money, ids, rbac, audit.
    services/       Business rules and workflows, one file per area (accounts, applications, membership, members,
                    payments, events, lending, comms, expenses, reports, dashboard, directory, settings, notifications, pdf).
    providers/      Adapters for external systems behind interfaces: payment gateway, credit bureau, email/SMS.
    routes/         HTTP boundary: parse and validate input -> call a service -> shape the response.
    jobs/runner.ts  In-process scheduler for the outbox, payment reconciliation/expiry and the nightly membership run.
    generated/      Prisma client (generated; never edit).
  prisma/
    schema.prisma   Single schema (30+ models).
    migrations/     Timestamped, forward-only SQL migrations (prisma migrate deploy).
    seed.ts         Demo data for local development (refuses to run in production).
  test/             Vitest against a real PostgreSQL (mlaz_test). No mocks of the database.
```

### Module responsibilities

| Module | Owns | Public interface (used by routes/jobs) |
| --- | --- | --- |
| `services/accounts` | Sign-in, throttling and challenge mode, sessions and refresh rotation, invites and passwords, 2FA, staff users | `login`, `refresh`, `logout*`, `requestPasswordReset`, `setPassword`, `sendInvite`, MFA functions |
| `services/applications` | Applicant journey, maker/checker review, duplicate checks, application fees | `submit`, `list`, `detail`, `recommend`, `approve`, `reject`, `returnToApplicant`, `recordOfflinePayment` |
| `services/membership` | Standing rules, dues periods, accreditation, certificates, suspension, MoF renewals, nightly rules | `duesInfo`, `inGoodStanding`, `memberSummary`, `submitRenewal`, `verifyRenewal`, nightly jobs |
| `services/members` | Secretariat member management and the member's own account actions | `list`, `detail`, `update`, `updateOwnProfile`, `startDuesPayment`, `recordOfflineDues`, ... |
| `services/payments` | Payment creation, gateway initiation, settlement (exactly once), bank transfers, reconciliation, webhooks | `createPayment`, `initiate`, `settle`, `handleWebhook`, `reconcilePending`, `expireStale`, `paymentView` |
| `services/notifications` | Message templates and the transactional outbox | `notify`, `T`, `processOutbox` |
| `providers/*` | Talking to one external system; no database access | `PaymentProvider`, `CreditBureau`, mailer/SMS sender |

### Dependency rules (enforced)

```
routes   ->  services  ->  lib
routes   ->  lib                 (parse, errors, guards, helpers)
services ->  providers
providers -> lib                 (config, errors, tokens)
jobs     ->  services, lib
```

- `lib/` and `providers/` never import `services/`, `routes/` or `jobs/`.
- `services/` never import `routes/`, `jobs/` or `fastify`: they take plain values, so routes, jobs, scripts and tests
  can all call them.
- `providers/` never touch the database client: services decide what to store.
- There are no import cycles (verified with a full import-graph scan in October 2026).

These rules are checked by `server/test/architecture.test.ts`, which runs in the API suite (CI and pre-push).

Routes may read through `prisma` for a simple lookup (a list, a record by id, scoped to the caller). Anything that
writes, enforces a rule, audits, or spans several steps belongs in a service.

---

## Request lifecycle

```
HTTP request
  | request id             x-request-id from a trusted proxy if well-formed, else a new UUID; echoed in the response
  | @fastify/helmet        CSP (default-src 'none'), HSTS, nosniff, no-referrer, frame-ancestors 'none'
  | @fastify/cors          Origin allow-list; credentials only for the UI origin(s)
  | @fastify/rate-limit    Global per-IP ceiling (RATE_LIMIT_PER_MINUTE); sensitive routes set tighter limits
  | @fastify/cookie        Refresh-token and recognised-device cookies
  | @fastify/multipart     Parts stream to private temp files (never buffered in memory)
  | onSend                 Cache-Control: no-store on personal-data routes; x-request-id

Route (prefix /api)
  /auth/*       No session; per-route limits; cookie endpoints require same Origin + x-mlaz-csrf header
  /public/*     No session; per-route limits
  /portal/*     preHandler: authenticate -> requireMember (everything scoped to the caller's member record)
  /admin/*      preHandler: authenticate -> requireStaff(permission)
  /webhooks/*   HMAC signature over timestamp + raw body, replay window, timing-safe compare

Handler
  1. parse(schema, input)  -> 400 VALIDATION_FAILED listing each field
  2. service call          -> transactions, rules, audit live here
  3. reply                 -> plain view objects (Prisma Decimal sent as numbers)

Error handler (app.ts)
  AppError                        -> { error: { code, message, details? } } with its status
  ZodError (schema.parse in a service) -> same 400 VALIDATION_FAILED shape as parse()
  Prisma P2002 / P2025            -> 409 DUPLICATE / 404 NOT_FOUND
  Fastify 4xx                     -> forwarded with its code
  anything else                   -> 500 { code: INTERNAL, message, requestId }; logged with the stack, never sent
```

### Error format and codes

Every error response is `{ "error": { "code": string, "message": string, "details"?: unknown } }`. A 500 also carries
`requestId` so a user can quote it and support can find the log line.

Generic codes: `BAD_REQUEST`, `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `DUPLICATE`,
`TOO_MANY_REQUESTS`, `INTERNAL`, `NOT_READY` (health). Domain codes come from the error factories' code argument, for
example `INVALID_CREDENTIALS`, `TOO_MANY_ATTEMPTS`, `TOO_MANY_CODES`, `MFA_SETUP_REQUIRED`, `WRONG_PORTAL`,
`DUES_NOT_PAYABLE`, `SUSPENDED`, `MAKER_CHECKER`, `AMOUNT_MISMATCH`, `UPLOADS_BUSY`, `STORAGE_FULL`. Clients may rely on
codes; messages are for people and may change.

---

## Security model

### Authentication

- Passwords: argon2id; minimum 10 characters; breached-password, common-word and name-similarity checks.
- Brute-force throttling (counted before the hash check, so timing does not reveal accounts):
  - Per address across all accounts: 50 failures in 15 minutes -> 1/4/16/60-minute block.
  - Per account from one address (or one recognised device): 5 failures -> same graduated block.
  - Per account from unrecognised devices across all addresses: 10 failures switch the account to **challenge mode**
    for an hour. Nobody is locked out: a correct password from an unrecognised device must be confirmed with a code
    emailed to the owner (or the authenticator app). Recognised devices (signed httpOnly cookie) sign in as normal.
- Per-account email caps (whoever asks, from however many addresses): 3 password-reset emails and 5 sign-in codes per
  hour. Over the cap nothing is sent and the last link or code keeps working; the reset endpoint answers the same
  either way, so it reveals nothing about which emails have accounts.
- Emailed codes: 6 digits, 10 minutes, 5 tries per code, single use, stored hashed.
- Access tokens: 15-minute HS256 JWTs; issuer, audience and type checked; algorithm pinned. The session is re-read on
  every request, so sign-out, deactivation and role changes apply immediately.
- Refresh tokens: httpOnly, SameSite=Strict, path `/api/auth`; rotated on every use; reuse of a spent token (or two
  simultaneous uses) ends every session of the user.
- Session lifetime: idle timeout `SESSION_IDLE_TIMEOUT_HOURS` (24) and absolute lifetime
  `SESSION_ABSOLUTE_LIFETIME_HOURS` (168), fixed at sign-in. Refreshing never extends the absolute deadline
  (`sessionDeadline` in `lib/auth.ts`, checked on every request and every refresh).
- Password change, reset, deactivation, MFA reset and "sign out everywhere" invalidate every session.

### Two-factor (TOTP)

- RFC 6238, 6 digits, 30-second step, ±1 step drift; each code usable once.
- Secret encrypted at rest with AES-256-GCM (`DATA_ENCRYPTION_KEY`); 8 hashed recovery codes.
- `REQUIRE_STAFF_2FA=true` (mandatory in production) forces enrolment for all staff.

### Uploads

- Streamed to private temp files (mode 0600, created exclusively); the type is sniffed from content, never trusted
  from the client. Per-file limit `UPLOAD_MAX_FILE_MB` (10), at most 4 files and 40 small text fields per request.
- Concurrency (`UPLOAD_MAX_CONCURRENT`), temp-space (`UPLOAD_TEMP_QUOTA_MB`), time (`UPLOAD_TIMEOUT_SECONDS`) and
  total storage (`STORAGE_QUOTA_MB`) quotas. Temp files are removed when the response ends or the client disconnects.
- Stored documents are served as attachments under `sandbox; default-src 'none'`, never cached.

### Browser UI

- CSP in `vercel.json`: `script-src 'self'`, `script-src-attr 'none'`, no inline or injected script; the dev and
  preview servers send the same script rules (`vite.config.js`). Tested in `test/csp.test.mjs`, including the built
  bundle.
- Event handlers are `data-on-*` attributes dispatched by one delegated listener to registered functions only.
- All server data is escaped with `esc()` before it reaches HTML (`src/ui.js`). `style-src` still allows inline styles
  (avatar colours); low risk, noted as debt.
- The access token lives in memory only; browser storage holds display details, never tokens.

---

## Data and consistency

- Writes that belong together run in one `prisma.$transaction`; services take a `Db`/`Tx` so they compose.
- `lockKey()` (`pg_advisory_xact_lock`) serialises work on shared things that have no single row to lock.
- Payment settlement locks the payment row (`SELECT ... FOR UPDATE`) and applies an outcome exactly once.
- Emails and SMS go through an **outbox** written in the same transaction as the change that caused them, delivered by
  the job runner with `SKIP LOCKED`, exponential back-off and at most 5 attempts.
- Every change writes an audit entry in the same transaction (`audit()`); member-visible events also write
  `activity()`.
- Network calls are never made inside a database transaction, with one documented exception: the credit-bureau lookup
  (`services/lending.ts`) runs under an advisory lock with a 20-second transaction timeout, to enforce the daily quota.

### Payment gateway failures

`initiate()` sends a committed payment to the gateway once, never retrying (a gateway adapter that retries must use the
payment `ref` as its idempotency key), and waits at most `PAYMENT_INITIATE_TIMEOUT_SECONDS`.

- Gateway unreachable or too slow: the payer is told to try again and the payment is marked failed with a reason that
  still accepts a **late success**, because the money may have moved. If the gateway answers late, its reference is
  stored, so its webhook (or reconciliation) settles the payment.
- Gateway accepted but its reference could not be saved: the request fails and the payment stays pending (closed by the
  expiry job), rather than being marked failed while money may move.
- Webhook amounts must match; a mismatch is audited and not applied.

### Migrations

- Forward-only SQL in `server/prisma/migrations`, applied with `npm run db:deploy` (`prisma migrate deploy`).
- Check for drift before release: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
  against a migrated database must print an empty migration.
- `20261021120000_session_lifetime_and_login_challenge` revokes every refresh token: **everyone is signed out once** on
  deploy, and instances still running the old code issue tokens the new code rejects. Deploy it with all instances
  replaced at once (not a rolling deploy), at a quiet time.
- `20261028090000_query_indexes` adds indexes only (plus drops one index made redundant). Safe to apply online.

---

## Background jobs (`jobs/runner.ts`)

In the API process, on every instance, safe to run concurrently:

| When | Job | Cross-instance safety |
| --- | --- | --- |
| Every 10 s | `processOutbox` | `FOR UPDATE SKIP LOCKED` |
| Every 10 s (sandbox) / 5 min | `reconcilePending` | Settlement locks the row; final outcomes apply once |
| Every 10 s | `expireStale` | Same |
| Daily from 01:00 Lusaka | lapse periods, expire MoF authorizations, reminders, prune auth records | Claimed once per day by an atomic upsert |

Each job is isolated: one failing (for example the mail server is down) is logged with its name and does not stop the
others. A tick never overlaps itself. On shutdown no new job starts and the one in progress finishes first.
`JOBS_ENABLED=false` turns the scheduler off (tests, or a web-only instance).

---

## Operations

### Startup and shutdown

1. Config is validated; in production, unsafe settings stop the start (`productionProblems()` in `config.ts`).
2. The server listens; only then do background jobs start.
3. On SIGTERM/SIGINT: new requests get 503, in-flight requests and the running job finish, the database pool closes,
   the process exits 0. A 25-second backstop forces exit 1 if something hangs.
4. An uncaught exception or unhandled rejection is logged as `fatal`, then the same shutdown runs and the process exits
   1, so the process manager starts a clean instance.

### Health probes

| Endpoint | Meaning | Use as |
| --- | --- | --- |
| `GET /health/live` | The process is up and serving | Liveness probe (restart on failure) |
| `GET /health` | The database answered within 2 s | Readiness probe / load-balancer check (503 `NOT_READY` otherwise) |

Probes are exempt from rate limiting. Both return 503 while the instance shuts down.

### Logging

- Structured JSON (pino) in production, pretty in development, silent in tests; level `LOG_LEVEL`.
- Every line of a request carries its id (`reqId`), the same value returned in `x-request-id`.
- Never logged: request bodies, headers, cookies, one-time tokens in URLs (redacted), emailed codes and links
  (redacted in the outbox once sent). A pino `redact` list removes password and token fields as a safety net.
- CSP violation reports from the UI are logged with origins and paths only (`POST /api/csp-report`).

### Database connections

| Setting | Default | Meaning |
| --- | --- | --- |
| `DB_POOL_MAX` | 10 | Connections per instance. Instances × pool must stay below the server's `max_connections`. |
| `DB_CONNECT_TIMEOUT_SECONDS` | 10 | A request waiting longer than this for a connection fails instead of hanging. |
| `DB_STATEMENT_TIMEOUT_SECONDS` | 0 (off) | Optional cap on a single statement. Set it only after checking report/export timings. |

### Production checklist

- Strong, distinct 48+ character random `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `WEBHOOK_SECRET` (enforced).
- `REQUIRE_STAFF_2FA=true`, `COOKIE_SECURE=true`, https `CORS_ORIGINS` and `PUBLIC_APP_URL` (enforced).
- `TRUST_PROXY_HOPS` set explicitly to the number of proxies in front of the API (enforced).
- `SMTP_URL` set (enforced); `STORAGE_DRIVER=s3` with a private bucket.
- A real `PAYMENT_PROVIDER` (only the sandbox exists today; `ALLOW_SANDBOX_IN_PRODUCTION` only for staging).
- Probes wired to `/health/live` and `/health`; the process manager's stop grace period at least 30 s.
- Branch protection on `main` requiring the three CI checks (see QUALITY_CHECKS.md).

---

## Storage and providers

| Interface | Drivers | Notes |
| --- | --- | --- |
| `Storage` (`lib/storage.ts`) | `local` (`STORAGE_DIR`), `s3` | Keys are server-generated; local paths confined to the root; S3 server-side encryption; streamed reads and writes |
| `PaymentProvider` | `sandbox` | Implement the interface for a real gateway (see "Payment gateway failures") |
| `CreditBureau` | `simulated` | Real bureau needs an adapter with timeouts and the bureau's consent terms |
| Email / SMS (`providers/messaging.ts`) | SMTP via nodemailer, or log; SMS log only | A real SMS gateway goes behind `sendSms()` |

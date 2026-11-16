# MLAZ Platform: Architecture

Node.js 24 · TypeScript · Fastify 5 · Prisma 7 · PostgreSQL 17 · vanilla-JS UI built with Vite

Two npm projects in one repository, deployed independently:

| Project | Folder | What it is |
| --- | --- | --- |
| UI | `/` (`src/`, `index.html`) | Static site deployed to Vercel. Public site, member portal, Secretariat console. Talks to the API only. Structure: [frontend-architecture.md](frontend-architecture.md). |
| API | `server/` | One Fastify process: HTTP API plus in-process background jobs. Deployed separately. |

The API is a **modular monolith**: one deployable and one database, split into twelve business modules with enforced
boundaries. Nothing in the current load or team size justifies splitting it into services; the boundaries below are
what would make that possible later. Each module, with what it owns and offers, is described in
[backend-modules.md](backend-modules.md); the reasons behind the main choices are in [decisions.md](decisions.md).

Deployment, backups, rollback and failure handling: [OPERATIONS.md](OPERATIONS.md). Quality and security tooling (lint,
format, tests, CI, pre-push hook, dependency audit, secret scan) is described in
[QUALITY_CHECKS.md](QUALITY_CHECKS.md).

---

## API folder layout

```
server/src/
  index.ts              Entry point: build app -> listen -> start jobs. Graceful shutdown, process-level error handling.
  config.ts             Zod-validated environment, the only place settings are read. Refuses unsafe production starts.
  platform/             Above every module: the composition root and the runtime.
    modules.ts          The module list, and wireModules(): connects the ports (below).
    http/               Fastify instance, plugins, request ids, error format, health probes, CSP reports, route scopes.
    jobs/               scheduler.ts (when work runs) and leases.ts (one instance at a time, in Postgres).
  shared/               Below every module, no business rules: db client and locks, errors, validation, dates, money,
                        reference numbers, tokens, timeouts, CSV, PDF plumbing, the Actor type, HTTP helpers for routes.
  modules/<module>/     One business area each (see backend-modules.md):
    domain/             Pure rules and types. No I/O, no Fastify, no Prisma, no configuration.
    application/        Use cases: a transaction, the rules, the audit entry, the queued message. No HTTP.
    infrastructure/     Adapters to the outside world behind interfaces: gateways, the credit bureau, mail and SMS,
                        file storage, PDF rendering, hand-written SQL (throttle counters).
    presentation/       Routes: parse and validate input -> call a use case -> shape the response. No database.
    index.ts            The module's public interface for other modules' use cases.
    http.ts             Only identity (session guards) and documents (uploads, downloads): for other modules' routes.
    module.ts           What the module hands the platform: its routes, per scope.
  generated/            Prisma client (generated; never edit).
server/prisma/          schema.prisma (single schema), forward-only migrations, seed.ts (refuses to run in production).
server/test/            Vitest against a real PostgreSQL (mlaz_test), plus architecture and domain unit tests.
```

A module has only the layers it needs: audit, administration and finance have no domain rules of their own, and
nothing outside lending, payments, membership, documents, communications and identity talks to an external system.

The twelve modules: **identity** (users, sessions, sign-in protection, 2FA, staff, RBAC), **membership** (register,
standing, dues, accreditation, certificates, MoF renewals, nightly rules, public directory), **applications** (applicant
journey, maker/checker review), **payments** (gateway, settlement, bank transfers, reconciliation), **events**,
**finance** (expenses), **lending** (loan books, credit checks), **communications** (outbox, announcements, broadcasts,
resources), **documents** (uploads, storage, document records), **administration** (settings, tiers), **audit** (audit
trail, member timelines) and **reporting** (dashboards, reports, search: read models over the others).

### Layer rules (enforced)

```
presentation  ->  application  ->  domain
                  application  ->  infrastructure  (adapters; infrastructure may use application types only)
presentation  ->  shared/http, identity/http.ts, documents/http.ts
any layer     ->  shared (domain: only dates, money, errors, tokens, actor)
```

- **Domain** is pure: no HTTP, no database client or generated Prisma code, no configuration, no other layer, no other
  module. Prisma enum values the rules need are restated as string unions (they are structurally the same type).
- **Application** never imports Fastify, a presentation layer or any `http.ts`: use cases take plain values and return
  plain values, so routes, jobs, scripts and tests call them alike.
- **Infrastructure** never imports HTTP or presentation, and imports only *types* from the application layer.
- **Presentation** never touches the database client or infrastructure, and imports generated Prisma code for types
  only. Business logic, transactions and audit entries live in use cases.
- Only the documents module touches the file system (`node:fs`), where paths built from request data are confined.

### Module rules (enforced)

- Another module is reached only through its `index.ts` (from any layer) or its `http.ts` (from presentation only).
  Nothing imports another module's internal files. An `index.ts` exports only what other code uses (a module nothing
  depends on, such as reporting, exports nothing).
- A `module.ts` is imported only by the platform. Modules never import the platform; the shared kernel imports neither.
- **No import cycles** between files, and **no dependency cycles between modules**. The module graph counts business
  dependencies (domain, application, infrastructure, `index.ts`); a route's use of the `identity/http.ts` guards is
  request-pipeline wiring and is left out of that graph, but it stays in the file graph, which is also acyclic.
- **One writer per table.** Every Prisma model has an owning module; only that module creates, updates or deletes its
  rows, and other modules change them through the owner's public functions (for example `documents.recordDocument`,
  `payments.linkToMember`, `payments.cancelForEvent`). Reads across modules are allowed; reporting only reads. Raw SQL
  writes follow the same map (`LoginThrottle` by identity, `Counter` by the shared kernel, `JobLease` and the nightly
  claim in `Setting` by the platform).
- **Background jobs reuse use cases.** The scheduler decides when work runs and writes no business table.

All of these are checked by `server/test/architecture.test.ts` (23 rules, no database needed), which runs in the API
suite in CI and in the pre-push hook. Each failure lists the offending import or write.

### Ports: dependencies turned around

Two connections would otherwise make a lower module depend on a higher one. They are interfaces owned by the lower
module and implemented by the higher one, connected once by `wireModules()` in `platform/modules.ts`:

| Port | Defined by | Implemented by | Why |
| --- | --- | --- | --- |
| `SettlementHandler` (per payment purpose) | payments | applications (accredit on payment), membership (extend dues), events (confirm or release places) | Payments knows how money moves; the module that sells something knows what a payment for it does. Settlement used to import membership and events directly. |
| `AudienceDirectory` | communications | membership | Broadcasts need member contacts, and membership needs the outbox. |

`wireModules()` is idempotent and is called by `buildApp()`, by the job scheduler and by the test setup. A payment
whose purpose has no handler throws instead of settling, so a wiring mistake can never mark money received without
applying it.

### Request scopes

`platform/http/app.ts` mounts each module's routes into one of five scopes; the scope sets the prefix and the guard,
so a module cannot forget either:

| Scope | Prefix | Guard |
| --- | --- | --- |
| `auth` | `/api/auth` | None (per-route limits; cookie endpoints need same Origin and `x-mlaz-csrf`) |
| `public` | `/api/public` | None (per-route limits) |
| `portal` | `/api/portal` | `requireMember` (everything scoped to the caller's member record) |
| `admin` | `/api/admin` | `requireStaff()`, plus a permission per route |
| `webhooks` | `/api/webhooks` | Signature over timestamp and raw body |

Every URL, method, request and response is unchanged by the modularisation.

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
  2. use case call         -> transactions, rules, audit live here
  3. reply                 -> plain view objects (Prisma Decimal sent as numbers)

Error handler (platform/http/error-handler.ts)
  AppError                        -> { error: { code, message, details? } } with its status
  ZodError (schema.parse in a use case) -> same 400 VALIDATION_FAILED shape as parse()
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
  (`sessionDeadline` in `modules/identity/application/sessions.ts`, checked on every request and every refresh).
- Password change, reset, deactivation, MFA reset and "sign out everywhere" invalidate every session.

### Two-factor (TOTP)

- RFC 6238, 6 digits, 30-second step, ±1 step drift; each code usable once, in any session (the last used step is
  stored per user and claimed atomically).
- Attempts are counted so that guessing cannot lock the owner out: 5 per sign-in step (a step that succeeded or ran out
  needs the password again, and two parallel completions give one session), 5 per 15 minutes per account from
  unrecognised devices, separately per recognised device, and per session for the code that confirms a sensitive change.
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
- All server data is escaped with `esc()` before it reaches HTML (`src/core/html.js`). `style-src` still allows inline styles
  (avatar colours); low risk, noted as debt.
- The access token lives in memory only; browser storage holds display details, never tokens.

---

## Data and consistency

- Writes that belong together run in one `prisma.$transaction`; use cases take a `Db`/`Tx` so they compose across
  modules (a settlement handler runs inside the settlement transaction, with the payment row locked).
- Session writes are atomic: starting a session writes the session and its first refresh token together; a refresh
  retires the old token and writes its successor in one transaction; sign-out, "sign out everywhere" and a password
  change each commit in one transaction.
- `lockKey()` (`pg_advisory_xact_lock`) serialises work on shared things that have no single row to lock.
- Payment settlement locks the payment row (`SELECT ... FOR UPDATE`) and applies an outcome exactly once.
- Emails and SMS go through an **outbox** written in the same transaction as the change that caused them, delivered by
  the job runner with `SKIP LOCKED`, exponential back-off and at most 5 attempts.
- Every change writes an audit entry in the same transaction (`audit()`); member-visible events also write
  `activity()`.
- Network calls are never made inside a database transaction, with one documented exception: the credit-bureau lookup
  (`modules/lending/application/credit-checks.ts`) runs under an advisory lock with a 20-second transaction timeout, to enforce the daily quota.

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
- `20261103090000_hot_query_indexes` adds indexes for payment totals by date, a record's audit trail and a member's
  pending renewal, and drops the index the trail one supersedes. Brief write locks while building (see
  [OPERATIONS.md](OPERATIONS.md)).
- `20261102090000_job_leases` adds the empty `JobLease` table. Safe for a rolling deploy: instances still on the old
  code ignore it (and keep reconciling on their own, as before, until they are replaced).

---

## Background jobs (`platform/jobs/scheduler.ts`)

In the API process, on every instance, safe to run concurrently:

| When | Job | Cross-instance safety |
| --- | --- | --- |
| Every 10 s | `processOutbox` | `FOR UPDATE SKIP LOCKED` |
| Every 10 s (sandbox) / 5 min | `reconcilePending` | One instance in the cluster per interval, under a lease (below); settlement locks the row and applies a final outcome once |
| Every 10 s | `expireStale` | Settlement locks the row; final outcomes apply once |
| Daily from 01:00 Lusaka | lapse periods, expire MoF authorizations, reminders, prune auth records | Claimed once per day by an atomic upsert |

Each job is isolated: one failing (for example the mail server is down) is logged with its name and does not stop the
others. A tick never overlaps itself. On shutdown no new job starts and the one in progress finishes first.
`JOBS_ENABLED=false` turns the scheduler off (tests, or a web-only instance).

**Reconciliation lease** (`platform/jobs/leases.ts`, table `JobLease`). Postgres is the one store every instance shares (there is
no Redis), so the lease lives there; an in-memory lock would not protect a second instance.

- Acquired with one atomic upsert that only takes over an expired lease, so exactly one instance wins a race.
- Times come from the database clock, so instances with drifting clocks agree on when a lease ends.
- Renewing and releasing need the holder's random owner token. Before each payment the holder renews the lease
  (3 minutes, longer than one gateway query can take); if that fails, it lost the lease and stops.
- A crashed holder needs no clean-up: its lease runs out.
- After a run the lease is kept until 5 minutes after the run started, so the cluster queries the gateway once per
  interval, not once per instance. With the sandbox it is released at once, so payments settle within a tick.
- If two runs ever overlapped (a run outliving its lease between two checks), the payment row lock and the "already
  final" check in `settleInTx` still apply each outcome once. Each gateway status query is bounded by
  `PAYMENT_INITIATE_TIMEOUT_SECONDS`.

**Nightly rules catch up.** Each rule runs even when an earlier one fails, and the run reports which failed.

- Lapsing and MoF expiry act on everything already past its date.
- Dues reminders (60, 30 and 7 days before the end of the paid period) and MoF reminders (30 and 7 days before
  expiry) are due from their offset until the date itself, not only on the exact day. A night that did not run, or
  failed, is caught up by the next run.
- After several missed nights only the most urgent reminder goes out, with the true number of days left.
- `ReminderLog` (unique per member and reminder key, written in the same transaction as the queued message) makes each
  reminder go out once, including when two runs overlap. A reminder that fails leaves no row and is sent the next
  night.
- Reminders skip members who are not active, who have already paid ahead, or whose MoF renewal awaits review. Days
  are counted in Lusaka calendar days.

**Outbox and slow mail servers.** Sends are serial and each is capped (`SMTP_SEND_TIMEOUT_SECONDS`). A worker claims a
batch for 5 minutes and starts a send only while a whole send still fits in that claim. Otherwise the claim could
lapse mid-batch, another worker would take the same messages and send them twice. Unstarted messages go straight back
to the queue without using up an attempt. Failures keep the existing policy: back off 2, 4, 8 and 16 minutes, give up
after 5 attempts. They are logged with the message id and the SMTP error, never the recipient or the body.

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

`GET /health/status` (only when `MONITORING_TOKEN` is set; `Authorization: Bearer <token>`) reports operational
checks for a monitoring service: database, overdue and failed outbox messages, gateway payments pending over 30
minutes, the nightly run, this instance's background jobs, and each integration's state (`shared/integrations.ts`).
Counts only, never personal data; 503 when a check fails. Thresholds and alerts: OPERATIONS.md.

### Logging

- One structured JSON (pino) logger for the process (`shared/log.ts`), pretty in development, silent in tests; level
  `LOG_LEVEL`. Fastify uses it for the request log, and modules write through `log()`.
- Every line of a request carries its id (`reqId`), the same value returned in `x-request-id`. Inside a request,
  `log()` returns that request's logger (an AsyncLocalStorage set in a `preValidation` hook), so a use case's lines
  carry the id without being handed a logger; in background jobs it returns the process logger.
- Operational events carry an `event` field (`job.failed`, `outbox.gave_up`, `storage.failed`, `auth.sign_in_failed`,
  `auth.refresh_token_reuse`…; the full list is in OPERATIONS.md) for monitoring to count and alert on.
- Never logged: request bodies, headers, cookies, one-time tokens in URLs (redacted), emailed codes and links
  (redacted in the outbox once sent), recipients, NRCs, credit reports. A pino `redact` list removes credential,
  session, MFA and identity fields as a safety net.
- CSP violation reports from the UI are logged with origins and paths only (`POST /api/csp-report`).

### Database connections

| Setting | Default | Meaning |
| --- | --- | --- |
| `DB_POOL_MAX` | 10 | Connections per instance. Instances × pool must stay below the server's `max_connections`. |
| `DB_CONNECT_TIMEOUT_SECONDS` | 10 | A request waiting longer than this for a connection fails instead of hanging. |
| `DB_STATEMENT_TIMEOUT_SECONDS` | 0 (off) | Optional cap on a single statement. Set it only after checking report/export timings. |

### External service timeouts

No call to another service can hold a request or the background jobs indefinitely.

| Service | Setting | Default | Bounds |
| --- | --- | --- | --- |
| SMTP | `SMTP_CONNECT_TIMEOUT_SECONDS` | 10 | DNS, connecting and the server's greeting |
| SMTP | `SMTP_SOCKET_TIMEOUT_SECONDS` | 30 | Silence on an open connection (a stalled login or message) |
| SMTP | `SMTP_SEND_TIMEOUT_SECONDS` | 60 (max 240) | One whole message; must fit inside the outbox's 5-minute claim |
| S3 | `S3_CONNECT_TIMEOUT_SECONDS` | 5 | Opening a connection |
| S3 | `S3_SOCKET_TIMEOUT_SECONDS` | 30 | Silence on an open connection, a download's body included |
| S3 | `S3_OPERATION_TIMEOUT_SECONDS` | 120 | A whole operation with its retries, up to the start of a download's body |
| S3 | `S3_MAX_ATTEMPTS` | 3 | Tries per operation |
| Gateway | `PAYMENT_INITIATE_TIMEOUT_SECONDS` | 30 | Starting a payment, and each reconciliation status query |
| Credit bureau | `BUREAU_TIMEOUT_SECONDS` | 10 (max 15) | One lookup, inside the member's credit-check lock; a timeout is a 503, neither recorded nor counted |

- **SMTP.** A failed send is a `DeliveryError` whose message carries the SMTP code and reply, with credentials
  scrubbed. The outbox retries it.
- **S3.** Only timeouts, connection resets, throttling (429) and 5xx answers are retried, with exponential backoff and
  full jitter (200 ms base, 5 s cap). The SDK's own retries are off, because an upload is a file stream and only a
  fresh stream per attempt can be sent again. A missing object is a 404. Any other failure is a 503
  `STORAGE_UNAVAILABLE`, logged with the operation and the (server-generated) key.

### Production checklist

- Strong, distinct 48+ character random `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `WEBHOOK_SECRET` (enforced).
- `REQUIRE_STAFF_2FA=true`, `COOKIE_SECURE=true`, https `CORS_ORIGINS` and `PUBLIC_APP_URL` (enforced).
- `TRUST_PROXY_HOPS` set explicitly to the number of proxies in front of the API (enforced).
- `SMTP_URL` set (enforced); `STORAGE_DRIVER=s3` with a private bucket.
- `SMS_DRIVER=none` (the log driver is refused) and `BUREAU_DRIVER=none` (the simulated bureau is refused unless
  `ALLOW_SANDBOX_IN_PRODUCTION`) until real adapters exist (enforced).
- `MONITORING_TOKEN` set and `/health/status` watched; migrations run once per release by the `migrate` image
  (`server/Dockerfile`), never on start.
- A real `PAYMENT_PROVIDER` (only the sandbox exists today; `ALLOW_SANDBOX_IN_PRODUCTION` only for staging).
- Probes wired to `/health/live` and `/health`; the process manager's stop grace period at least 30 s.
- Branch protection on `main` requiring the three CI checks (see QUALITY_CHECKS.md).

---

## Storage and providers

| Interface | Drivers | Notes |
| --- | --- | --- |
| `Storage` (`modules/documents/infrastructure/storage.ts`) | `local` (`STORAGE_DIR`), `s3` | Keys are server-generated; local paths confined to the root; S3 server-side encryption; streamed reads and writes. S3 calls are bounded (see "External service timeouts") |
| `PaymentProvider` (`modules/payments/infrastructure/gateways.ts`) | `sandbox` | Implement the interface for a real gateway (see "Payment gateway failures") |
| `CreditBureau` (`modules/lending/infrastructure/bureau.ts`) | `simulated`, `none` | Simulated reports are flagged `simulated` to the member. A real bureau needs an adapter and the bureau's consent terms; the use case already bounds the call (`BUREAU_TIMEOUT_SECONDS`) |
| Email / SMS (`modules/communications/infrastructure/messaging.ts`) | SMTP via nodemailer, or log; SMS `log` or `none` | With `SMS_DRIVER=none` no SMS is queued. A real SMS gateway goes behind `SmsSender` |

`Storage` also lists its objects, for the daily integrity sweep (`modules/documents/application/integrity.ts`): files
without a record are reported or, with `STORAGE_SWEEP=delete`, removed under safeguards; records without a file are
reported. Each integration's state (`live`, `simulated`, `off`) comes from `shared/integrations.ts`; see OPERATIONS.md,
"External integrations".

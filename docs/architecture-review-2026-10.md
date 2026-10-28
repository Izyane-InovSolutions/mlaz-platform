# Architecture review: October 2026

A review of the MLAZ platform (API in `server/`, UI in `src/`), what was changed as a result, and what remains. The
resulting architecture is described in [architecture.md](architecture.md); checks and tooling in
[QUALITY_CHECKS.md](QUALITY_CHECKS.md).

Scope: the working tree on branch `feat/backend` on 2026-10-28, including a large uncommitted security pass that was
already in progress (ESLint, CI, pre-push hook, session lifetime, streamed uploads, login challenge). That work was
reviewed and kept; this review builds on it.

## 1. Assessment of the starting point

The codebase was already in good shape. Starting from that baseline, every configured check passed: whitespace, format,
lint, typecheck, lockfiles, secret scan, dependency audit, both builds, UI tests, and 130/130 API tests against a real
PostgreSQL.

Strengths worth keeping:

- A conventional layered modular monolith (`routes -> services -> lib/providers`), with no import cycles across 45
  files and about 250 import edges.
- Validated configuration that refuses unsafe production starts. A typed `AppError` with one error format. Zod at
  every input boundary.
- Strong transactional discipline: advisory locks, row locks for payment settlement, an outbox for email and SMS,
  and audit records written in the same transaction as the change.
- Thorough integration tests against a real database rather than mocks.
- Mature CI: least-privilege permissions, actions pinned to SHAs, per-run secrets, Gitleaks over the full history, an
  audit policy with expiring exceptions, and a pre-push hook that mirrors CI.

## 2. Structural problems found

| # | Problem | Evidence | Status |
| --- | --- | --- | --- |
| S1 | `lib/` depended on `services/` (inverted layering) | `lib/guards.ts` imported `sessionDeadline` from `services/accounts.ts` | Fixed |
| S2 | Business logic in route handlers | `routes/portal.ts` profile update and dues checkout: rules, transactions and audit inline. 14 `prisma` uses and 7 audit calls in `admin-system.ts` | Partly fixed (portal); rest is debt (D1) |
| S3 | Duplicated logic | Validation-error formatting in two places; dues payment line text in two places; profile-update flow nearly copied | Fixed for these three; other copies are debt (D2) |
| S4 | Dead exports | `paged`, `assertExists`, re-exports of `paymentView` and `redactSecrets` | Removed (each confirmed unused with a grep) |
| S5 | Oversized modules | `services/accounts.ts` (about 550 lines, 6 concerns); `applications`, `payments` and `membership` 260 to 315 lines each | Debt (D3) |
| S6 | Layering rules documented but not enforced | No check stopped a new upward import | Fixed: `server/test/architecture.test.ts` |
| S7 | Text encoding damage | Middle dots double-encoded in `routes/portal.ts` (uncommitted change). These would have printed on receipts and in audit notes | Fixed. `format:check` now detects it |

## 3. Security risks named in the brief

| Risk | Status found | Action |
| --- | --- | --- |
| Distributed account lock-out from many IPs | Core issue fixed by the earlier pass: no account-wide lock; challenge mode with an emailed code; recognised devices are exempt | Closed the remaining abuse path: per-account caps on reset emails (3/h) and sign-in codes (5/h). Previously anyone could flood a victim's inbox from many addresses and keep invalidating their reset link. Regression tests added |
| Uploads buffered in memory (requests up to 40 MB) | Fixed: parts stream to private temp files; quotas, timeouts and cleanup are in place. The default total per request is about 41 MB, all on disk | Verified only |
| Sessions refreshable indefinitely | Fixed: absolute deadline set at sign-in and checked on every request and every refresh; old tokens revoked by migration | Verified only |
| CSP allowing inline script | Fixed: `script-src 'self'`, `script-src-attr 'none'`, delegated handlers, tested on source and built bundle | Verified. Also fixed 4 unescaped attribute/text values and a double-escaping bug in the admin UI |

## 4. Changes made in this review

Reliability and correctness:

- **Payment gateway failures** (`services/payments.ts`).
  - Before: an unreachable or slow gateway marked the payment FAILED with a reason that refused a later success, and
    lost the gateway's reference. A payer could be charged with no record.
  - Now: the initiation call is bounded (`PAYMENT_INITIATE_TIMEOUT_SECONDS`), a late success is honoured, and a late
    answer still records the reference. If the reference cannot be saved, the payment is left pending instead of
    marked failed. Two regression tests cover this.
- **Startup and shutdown** (`index.ts`).
  - Jobs start only after the server listens.
  - Shutdown runs once and is bounded by a 25 s backstop. It waits for the running job before closing the database.
  - Uncaught exceptions and unhandled rejections are logged as fatal and exit 1 after a clean shutdown.
- **Job runner** (`jobs/runner.ts`). Each job is isolated, so one failure no longer skips the others for that tick.
  The runner never overlaps itself, and on stop it starts no new job.
- **Health probes.**
  - `/health/live` for liveness, and `/health` for readiness (the database must answer within 2 s, otherwise 503).
  - Probes are exempt from rate limiting.
- **Database pool settings.**
  - `DB_POOL_MAX` (default 10, the same as before).
  - `DB_CONNECT_TIMEOUT_SECONDS` (default 10 s; previously a request could wait for a connection indefinitely).
  - `DB_STATEMENT_TIMEOUT_SECONDS` (off by default).
- **Indexes** (`20261028090000_query_indexes`). Added indexes for the per-account email-cap and newest-link queries
  (`UserToken`), broadcast delivery counts (`Notification`) and the nightly membership scans (`Member`).
  - Generated by Prisma from the schema; the schema and database were confirmed to have no drift before and after.

Observability:

- Request IDs: an `x-request-id` on every response, a well-formed one from a proxy is kept, and every log line of a
  request carries it. 500 responses include the `requestId`, and never the error details.
- A pino `redact` list as a safety net for password and token fields.

Structure:

- `sessionDeadline` moved to `lib/auth.ts` (S1).
- Portal profile update and dues checkout moved into `services/members.ts`, sharing the dues line with the
  Secretariat's offline path (S2, S3).
- Single source for validation errors (`validationFailed` in `lib/validate.ts`).
- Dead exports removed (S4). The duplicate import in `portal.ts` was merged.

Engineering standards:

- `format:check` detects double-encoded text.
- `scripts/check.mjs` no longer triggers Node's DEP0190 warning.
- Fastify's `maxParamLength` moved to `routerOptions` (FSTDEP022).

UI (`src/admin.js`, `src/public.js`):

- 4 server values in HTML attributes and text are now escaped.
- `tierBadge(esc(x))` double escaping fixed at 7 call sites.

### Compatibility notes

No endpoint, request or response field was removed or renamed.

Additions:

- The `x-request-id` header.
- `requestId` in 500 error bodies.
- `GET /health/live`.
- The 429 `TOO_MANY_CODES` error from sign-in, returned when an account has been sent 5 codes in an hour.

Behaviour changes:

- `/health` returns **503** (was 500) when the database is down.
- A request now fails after 10 s waiting for a database connection instead of hanging.
- A payment whose gateway was unreachable now accepts a late success. Previously such a success was ignored.

No migration other than the index migration was added.

## Verification report

Final run on 2026-10-28: `node scripts/check.mjs full --keep-going`, the same steps as CI, finished in 202 s.

| Check | Result |
| --- | --- |
| Whitespace (`git diff --check`) | Passed |
| Format (incl. new mojibake check) | Passed: 106 files |
| Lint (ESLint, zero warnings) | Passed |
| Type check (API, strict) | Passed |
| Lockfiles match manifests | Passed |
| Secret scan (Gitleaks: history plus staged and unstaged changes) | Passed: no leaks |
| Dependency audit | Passed: 0 vulnerabilities of any severity in either project |
| UI production build | Passed |
| API build | Passed |
| UI tests (CSP, inline-script scan of source and built bundle) | Passed |
| API tests incl. security regression and architecture tests | Passed: **144/144** in 10 files (baseline 130; 14 added) |
| Migration validation | Passed: the new migration applies cleanly and leaves no drift against the test database. The dev database still needs `npm run db:deploy` |
| Demo credentials absent from the production bundle | Passed: `Mlaz@2026demo` not found in `dist/` |
| Branch protection on `main` | Not verifiable from the repository (GitHub setting) |
| End-to-end browser tests | Not applicable: none exist. The UI is covered by the CSP tests and the API tests |

Each new regression test was checked against the unfixed code. With the cap or fix reverted, the test fails; with it
restored, it passes. This was done for the email caps, both gateway-failure tests, and the architecture test (a
reintroduced `lib -> services` import).

## 5. Technical debt and unresolved issues

Ordered by impact.

| # | Item | Why it matters | Suggested fix |
| --- | --- | --- | --- |
| D1 | Business logic still in `routes/admin-system.ts` (tier upsert with audit, settings changes without a transaction, staff invite, nav counts duplicating the dashboard), `admin-finance.ts` (payment list filters) and `public.ts` (application email with inline text) | Rules that bypass services are harder to test and to reuse | Move into `services/settings`, `services/accounts`, `services/payments` one route file at a time, with the existing API tests as the safety net |
| D2 | Remaining duplicates: 6 copies of the payment include shape; 3 receipt handlers; the upcoming-events query in 3 places; the "open application stages" list in 3 places; 47 `(req.params as …)` casts in 3 styles | Drift between copies (one gets fixed, another does not) | Export one constant or helper per item from its owning service; add a typed `params()` helper for routes |
| D3 | `services/accounts.ts` (about 550 lines) mixes throttling, device cookies, sessions, invites/passwords, MFA and user management | Hard to review; security-critical | Split into `accounts/throttle.ts`, `sessions.ts`, `passwords.ts`, `mfa.ts`, `users.ts` behind the same exports |
| D4 | Several multi-write operations are not in one transaction (`issueSession`, `refresh`, `logout`, `endAllSessions` with the default client) | A crash between writes can leave a session half-rotated (the user is signed out; no security impact found) | Wrap each in `prisma.$transaction` once D3 gives them a home |
| D5 | Per-item queries in list views: `events.listForStaff` / `listForMember` (2 queries per event), `comms.listBroadcasts` (1 per broadcast), several unbounded `findMany` in reports and lists | Slow pages as data grows | Batch with `groupBy`/`_count`; add `take` and paging to list endpoints |
| D6 | Nightly reminders target exact dates (validUntil = today + 60/30/7) | A failed nightly run skips those reminders for good | Match a window (`<=`), relying on `ReminderLog` to send each reminder once |
| D7 | A password holder can still exhaust the per-user authenticator-code counter, blocking 2FA steps for up to an hour | Requires the password; denial of service only | Count authenticator failures per session or attempt, not per user |
| D8 | No timeouts on SMTP (nodemailer defaults) or S3 (SDK defaults), and SMTP sends are serial inside the job tick | One hung send delays all background jobs | Set `connectionTimeout`/`socketTimeout` on the transport and a request handler timeout on `S3Client` |
| D9 | `reconcilePending` runs on every instance | N instances query the gateway N times per pending payment | Claim the reconcile run like the nightly job, or `SKIP LOCKED` over pending payments |
| D10 | UI: about 30 `innerHTML` sinks rely on manual `esc()`; helpers copied across `public.js`, `member.js` and `admin.js`; `style-src 'unsafe-inline'` | Each new template is a chance to forget `esc()` | A tagged `html` template that escapes by default, then enable `eslint-plugin-no-unsanitized`; move shared helpers into `ui.js` |
| D11 | Migration `20261021120000` signs everyone out and is not safe for a rolling deploy | Operational surprise | Deploy with all instances replaced at once, at a quiet time (documented in architecture.md) |
| D12 | No Prettier | Deliberate: it would rewrite about half the lines | Adopt in one dedicated commit listed in `.git-blame-ignore-revs` (see QUALITY_CHECKS.md) |
| D13 | ESLint does not enforce the layering (a plugin hook blocked editing `eslint.config.js`) | Feedback comes at test time rather than in the editor | Optional: add the `no-restricted-imports` blocks below; the architecture test enforces the same rules today |

ESLint snippet for D13 (insert before the `// API.` block in `eslint.config.js`):

```js
{
  files: ['server/src/lib/**/*.ts', 'server/src/providers/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/services/*', '**/routes/*', '**/jobs/*'], message: 'lib/ and providers/ sit below services, routes and jobs.' }] }] },
},
{
  files: ['server/src/services/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { paths: [{ name: 'fastify', message: 'Services must not depend on HTTP.' }], patterns: [{ group: ['**/routes/*', '**/jobs/*'], message: 'Services sit below routes and jobs.' }] }] },
},
```

## 6. Production-readiness checklist

Items marked **enforced** stop a production start when they are wrong.

- [x] Configuration validated at startup; unsafe production settings refuse to start (**enforced**)
- [x] Secrets only in the environment; `.env.example` holds placeholders; Gitleaks in pre-push and CI
- [x] Centralised error handling; no stack traces or internals in responses (tested)
- [x] Structured logs with request IDs; credentials redacted
- [x] Liveness and readiness probes; graceful shutdown; process-level failure handling
- [x] Database pool and connection-wait limits; migrations forward-only with a drift check
- [x] Security regression tests for every fixed vulnerability; architecture boundaries tested
- [x] CI runs every local check; actions pinned; least privilege
- [ ] Branch protection on `main` requiring the three CI checks (a GitHub admin must set it; not verifiable from code)
- [ ] A real payment gateway adapter (only `sandbox` exists). It must use `ref` as its idempotency key
- [ ] A real SMS gateway and credit-bureau adapter, each with timeouts
- [ ] SMTP and S3 client timeouts (D8)
- [ ] Probes and a 30 s or longer stop grace period configured in the hosting platform
- [ ] Load test of list endpoints before data grows (D5)
- [ ] Deploy plan for migration `20261021120000` (D11)

A successful build and green tests are not proof of production readiness. The unchecked items need decisions or
infrastructure outside this repository.

## 7. Recommended follow-up work

Prioritised by impact and risk.

1. **Real payment gateway adapter**, written to the contract in architecture.md: an idempotency key, timeouts, and no
   blind retries. It blocks taking real money. *High impact; medium risk; the tests in `payments.test.ts` show the
   expected failure behaviour.*
2. **SMTP and S3 timeouts (D8)** and the **reconcile claim (D9)**. Small changes that remove a way for one slow
   dependency to stall the instance. *High impact; low risk.*
3. **Reminder window (D6).** Small, and prevents silently missed dues reminders. *Medium impact; low risk.*
4. **Move the remaining route logic (D1) and remove duplicates (D2)**, one route file per change. *Medium impact; low
   risk with the current test suite.*
5. **Split `services/accounts.ts` (D3), then wrap the session writes in transactions (D4).** *Medium impact; medium
   risk; security-critical code, so review carefully.*
6. **Batch list queries and add paging (D5).** Before the member and event counts grow. *Medium impact; low risk.*
7. **Escape-by-default HTML templates in the UI (D10).** *Medium impact; medium effort.*
8. **Per-session authenticator-code counter (D7).** *Low impact; low risk.*

# MLAZ platform API

Backend for the Money Lenders Association of Zambia membership platform (the prototype UI in `../src`).
Node.js 22+, TypeScript, Fastify 5, PostgreSQL, Prisma 7.

## Run it

```bash
cd server
cp .env.example .env          # then set JWT_SECRET, DATA_ENCRYPTION_KEY and WEBHOOK_SECRET
npm install                   # also generates the Prisma client
npm run db:up                 # PostgreSQL in Docker on localhost:5435 (+ a mlaz_test database)
npm run db:deploy             # apply migrations
npm run db:seed               # demo data (same members/applications as the prototype)
npm run dev                   # http://localhost:3000, background jobs included
npm test                      # API tests (about 145, ~3 min) against mlaz_test
```

`npm run db:reset` drops the dev database, re-applies migrations and re-seeds.

Demo accounts (password `Mlaz@2026demo`, or `SEED_PASSWORD`):

| Email | Role |
| --- | --- |
| secretariat@mlaz.org.zm | Secretariat Admin: everything; the **checker** who approves recommendations |
| officer@mlaz.org.zm | Membership Officer: applications, members, MoF renewals; the **maker** |
| finance@mlaz.org.zm | Finance Officer: payments, bank-transfer review, expenses |
| comms@mlaz.org.zm | Communications Officer: events, announcements, broadcasts |
| info@quicklend.zm (and every seeded member email) | Member portal |

## How it is put together

```
src/
  app.ts            Fastify setup: security headers, CORS, rate limits, uploads, error format, routes
  index.ts          starts the server, then the background jobs; graceful shutdown
  config.ts         environment variables, validated at startup
  lib/              database client, auth (argon2 + JWT), role permissions, uploads, storage, audit, dates
  services/         business rules; one file per area (applications, membership, payments, events, ...)
  providers/        swappable adapters: payment gateway, credit bureau, email/SMS
  routes/           HTTP endpoints: auth, public, portal (members), admin-* (Secretariat), webhooks
  jobs/runner.ts    outbox delivery, payment settlement, nightly lapse/expiry/reminders
prisma/             schema, migrations, seed
test/               API tests (vitest + fastify.inject on a real Postgres)
```

### Rules the backend enforces

- **Application journey**: `DETAILS → MOF_REVIEW → recommended (maker) → approved (checker) → PAYMENT_PENDING → ACCREDITED`.
  Accreditation (member number, first dues period, certificate, portal invite) happens automatically when the payment succeeds.
- **Maker-checker** is enforced server-side: only an Admin can approve, and never their own recommendation (`403 MAKER_CHECKER`).
  Recommending requires the MoF expiry date and, if the automated checks flag anything (duplicate TPIN/PACRA/name/email/phone,
  missing documents), a written justification.
- **Good standing** (public directory, verification, certificate download) = `ACTIVE` + accreditation `ISSUED` + MoF `VALID` + paid period not ended.
- **Dues**: each payment extends `validUntil` by one year from the end of the current period. Dues become payable
  `renewalWindowDays` (default 60) before the period ends. Paying restores a lapsed member.
- **Nightly (01:00 Lusaka)**: ended periods → `LAPSED`; expired MoF authorization → `SUSPENDED (MOF_EXPIRED)`, lifted
  automatically when a renewal is verified; dues reminders at 60/30/7 days and MoF reminders at 30/7 days, each sent once.
  Suspensions imposed by staff are only lifted by staff.
- **Payments** settle exactly once (row lock + idempotent outcome). A second payment attempt is refused while one is in flight.
  A success that arrives after the server timed a payment out is still honoured. Bank transfers wait for proof of payment and a
  Finance confirmation. Card payments go to the gateway's hosted checkout, so card numbers never touch this server.
- **Events**: the event row is locked while registering, so capacity can't be oversold. Paid places are held while the payment
  is pending and released if it fails. Cancelling an event flags paid registrations for refund and notifies members.
- **Credit checks** need the borrower's consent and a purpose, are logged with the result, and are capped per member per day.
- **Audit trail**: every decision and change is recorded with who, when and what (`AuditLog`), including staff viewing documents.
- **Notifications** are written to an outbox in the same transaction as the change, then delivered by the job runner with retries.

## Security

Every item below is enforced on the server and covered by tests (`test/security.test.ts` and the other suites).

**Sign-in and sessions**
- Passwords: argon2id; at least 10 characters, common and repetitive passwords refused, and not built from the email name.
- Password guessing is limited in layers, counted atomically in Postgres so every API instance shares the numbers
  (attempts are counted before the password is checked, so parallel requests can't slip past a limit):
  50 attempts per address across all accounts; 5 per account from one address (or from one recognised device);
  and 10 per account from unrecognised devices across all addresses. Blocks are temporary and grow with repeats
  (1, 4, 16, then at most 60 minutes). **No one can lock a user out**: when an account is attacked from many addresses,
  a correct password from a device that has not signed in to it before must be confirmed with a 6-digit code emailed
  to the account (5 tries per code, 10 minutes), while devices that have signed in before (a signed `httpOnly` device
  cookie) carry on as normal. A password reset lifts all of it. Unknown emails are throttled exactly like real ones and
  a dummy hash equalises timing, so nothing reveals whether an account exists. Emails are normalised (case, spacing,
  Unicode form) before counting.
- Two-factor sign-in (TOTP, any authenticator app) for any account. The secret is encrypted at rest (AES-256-GCM,
  `DATA_ENCRYPTION_KEY`). Each code works once, eight hashed recovery codes are issued, and an admin can reset a
  colleague's lost device. Set `REQUIRE_STAFF_2FA=true` to force enrolment for all staff.
- Tokens: a 15-minute access token (JWT, HS256, issuer/audience/type checked) held only in the page's memory. The refresh
  token is an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`, so page scripts can never read it; cookie
  endpoints also require an allowed `Origin` and the `x-mlaz-csrf` header. Refresh tokens rotate, and re-use of a
  rotated one (or two uses at once) is treated as theft and ends every session.
- Session lifetime: every sign-in creates a session with a fixed absolute deadline (`SESSION_ABSOLUTE_LIFETIME_HOURS`,
  default 7 days) that refreshing never moves, plus an idle timeout (`SESSION_IDLE_TIMEOUT_HOURS`, default 24 hours).
  Refresh tokens, access tokens and the "keep me signed in" cookie never outlive the deadline, and the session is
  checked on every request, so sign-out and expiry take effect at once on every instance. Lowering either setting also
  shortens existing sessions. The UI serialises refreshes across tabs (Web Locks), so tabs can't trip theft detection.
- Changing or resetting a password, deactivation, resetting 2FA and "sign out everywhere" invalidate every existing
  access token immediately (millisecond-precise `sessionsValidAfter`). The user is re-read on every request.
- Invite and reset links are single-use, hashed at rest, short-lived (1 hour for resets), and only the newest one works.

**Access control**
- Every console route checks a role permission (`src/lib/rbac.ts`). Maker-checker is enforced server-side. Search and
  the dashboard only return what the role can open (no application pipeline or money figures for other roles).
- Members only reach their own records (payments, documents, loans, registrations). They can edit contact details but
  not their business name, location or registration numbers. The credit bureau and event registration need good standing.
- Applicants have no account: their tracking link carries a 192-bit HMAC token derived from the reference, so
  sequential references can't be enumerated.

**Input, output and files**
- Every body, query and param is validated with zod (lengths, formats, enums); unknown fields are dropped and control
  characters refused. All SQL goes through Prisma or tagged parameterised queries.
- Uploads are streamed to owner-only temporary files (`UPLOAD_TMP_DIR`, never under `STORAGE_DIR` or any served
  folder), never held in memory, and moved into storage (or streamed to S3) only once accepted. PDF/JPG/PNG only,
  detected from the file's bytes; `UPLOAD_MAX_FILE_MB` (10) per file, 4 files and 40 fields per request; a request whose
  declared size is already too large is refused before it is read (413); at most `UPLOAD_MAX_CONCURRENT` uploads in
  progress per instance (503) within `UPLOAD_TEMP_QUOTA_MB`; `UPLOAD_TIMEOUT_SECONDS` to arrive (408); all documents
  within `STORAGE_QUOTA_MB` (507). Temporary files are removed whatever happens (error, abort, timeout), and leftovers
  from a crash at start-up. Uploads are only read after the caller is authorised. Stored under random server-generated
  keys; the browser's file name is display-only. Downloads are streamed, always as attachments with
  `Content-Security-Policy: sandbox`, `nosniff` and `no-store`.
- Responses: helmet headers (strict CSP, HSTS, `no-referrer`, no framing). Personal-data responses are `no-store`.
  `POST /api/csp-report` accepts the UI's CSP violation reports and logs only the directive and URL origins/paths.
  Errors never leak internals or echo URLs. CSV exports neutralise spreadsheet formulas.
- Logs: tokens in URLs (`?t=`, `?token=`) and emailed sign-in codes are redacted. Delivered emails have their one-time links scrubbed from the
  outbox, and message bodies are never returned by the API.

**Network and payments**
- A global rate limit per client IP (`RATE_LIMIT_PER_MINUTE`), plus tighter limits on sign-in, resets, applications,
  verification and credit checks. `X-Forwarded-For` is only trusted for `TRUST_PROXY_HOPS` proxies, so IPs can't be spoofed.
- CORS allows only `CORS_ORIGINS`.
- Webhooks: HMAC over timestamp and body, constant-time comparison, a 5-minute replay window, and the reported amount
  must match the payment. Settlement is idempotent and row-locked. Checkout links must be HTTPS.

**Production start-up checks** (the server refuses to start otherwise)
- The secrets are present, high-entropy and all different.
- HTTPS-only cookies, `https://` origins and app URL.
- No sandbox payments unless `ALLOW_SANDBOX_IN_PRODUCTION=true`.
- `SMTP_URL` is set (without it, set-password and reset links would only be written to the log).
- `REQUIRE_STAFF_2FA=true`.
- `TRUST_PROXY_HOPS` is set explicitly (`0` if clients connect directly, `1` behind one load balancer).
- The demo seed refuses to run in production.

The log email/SMS drivers redact one-time links in every environment.

**Still your responsibility when deploying**
- Serve the UI and the API over HTTPS on the same site (e.g. `app.mlaz.org.zm` + `api.mlaz.org.zm`) so the `SameSite`
  cookie works.
- Set `TRUST_PROXY_HOPS` to the real number of proxies in front of the API.
- Run Postgres with encrypted disks/backups and a least-privilege database user.
- Sign-in throttling, sessions and upload limits that matter across replicas live in Postgres. The per-route request
  rate limits (`@fastify/rate-limit`) are still per instance (in memory): add a shared store (Redis) for those if you
  run several API replicas.
- Keep server clocks in sync (NTP): session deadlines and throttle windows are compared with the API's clock.
- Reverse proxy in front of the API (uploads): allow request bodies of at least 42 MB (4 × `UPLOAD_MAX_FILE_MB` + 2 MB),
  stream them rather than buffer them, and time out slow bodies. For nginx: `client_max_body_size 42m;`
  `proxy_request_buffering off;` `client_body_timeout 60s;` `proxy_read_timeout 150s;`. Never serve `STORAGE_DIR` or
  `UPLOAD_TMP_DIR` as static files.
- The UI's CSP (`vercel.json`) allows scripts only from its own origin: no inline scripts, inline event handlers,
  `javascript:` URLs or `eval` (pages use delegated `data-on-*` handlers, see `src/ui.js`). The dev server and
  `vite preview` send the same policy. To collect violation reports in production, add
  `report-uri https://<api-domain>/api/csp-report` to it once the API domain is fixed, and tighten `connect-src` to
  that domain. `style-src` still allows `'unsafe-inline'` because the markup uses `style` attributes.

## API

All endpoints are under `/api`. Errors look like `{ "error": { "code": "...", "message": "...", "details": ... } }`.
Money is a number in kwacha; dates are ISO strings (calendar dates come back as `YYYY-MM-DDT00:00:00.000Z`).

**Auth** `/api/auth`: `POST /login` `{email, password, portal?: 'staff'|'member'}` · `POST /refresh` · `POST /logout` · `GET /me` ·
`POST /password/forgot` · `POST /password/set` `{token, password}` (invite and reset links) · `POST /password/change`
- `POST /login` may answer `{mfaRequired: true, method: 'totp'|'email', mfaToken}`; finish with `POST /login/mfa`
  `{mfaToken, code}` (authenticator code, recovery code, or the emailed sign-in code). Sessions carry `sessionExpiresAt`.

**Public** `/api/public`: `GET /config` (tiers, fees, provinces, payment methods, bank account) · `GET /stats` · `GET /announcements` ·
`GET /events` · `GET /verify?q=` (member number, certificate serial or name) · `GET /directory?q=&province=&tier=&page=`
- `POST /applications` (multipart: `name, pacra, tpin, town, province, address, tier, contact, position, phone, email, director, directorNrc, mofRef?, declare` + files `pacraFile, nrcFile, mofFile?`) → `{ref, trackingToken, trackUrl}`
- With the tracking token: `GET /applications/:ref` · `POST /applications/:ref/mof` (multipart `mofRef` + `mofFile`) ·
  `POST /applications/:ref/payments` `{method, msisdn?}` · `GET /applications/:ref/payments/:payRef` (poll) ·
  `POST /applications/:ref/payments/:payRef/proof` (multipart `bankRef` + `proof`) · `GET …/receipt.pdf` · `GET /applications/:ref/certificate.pdf`
- `POST /applications/:ref/resend-link` `{email}`

**Member portal** `/api/portal` (member token): `GET /overview` · `GET|PATCH /profile` · `GET /activity` · `GET /certificate.pdf` ·
`GET|POST /mof-renewals` (multipart `mofRef` + `file`) · `GET /dues` · `POST /dues/payments` · `GET /payments` · `GET /payments/:ref` ·
`POST /payments/:ref/proof` · `GET /payments/:ref/receipt.pdf` · `GET /events` · `GET /events/:id` · `POST /events/:id/registrations`
`{tickets, method?, msisdn?}` · `DELETE /events/:id/registration` · `GET /announcements` · `GET /resources` · `GET /resources/:id/download` ·
`GET /documents/:id` · `GET|POST /loans` · `PATCH|DELETE /loans/:id` · `GET|POST /credit-checks` `{nrc, purpose, consent: true}`

**Secretariat** `/api/admin` (staff token; each route checks a permission, see `src/lib/rbac.ts`):
- `GET /dashboard` · `GET /nav-counts` (sidebar badges) · `GET /search?q=` · `GET /documents/:id`
- Members: `GET /members` (filters `q, status, tier, province, filter=good_standing|dues_due|mof_expired`) · `GET /members/export.csv` ·
  `GET|PATCH /members/:number` · `POST /members/:number/suspend|reinstate|reminders|offline-dues|users` · `GET /members/:number/certificate.pdf`
- `GET /renewals?status=` · `POST /renewals/:id/verify` `{mofExpiry}` · `POST /renewals/:id/reject` · `GET /certificates`
- Applications: `GET /applications?stage=OPEN|MOF_REVIEW|AWAITING_APPROVAL|…` · `GET /applications/:ref` (with checks, documents, payments, audit) ·
  `POST /applications/:ref/recommend` `{mofExpiry, note}` · `/approve` · `/decline-recommendation` · `/return` · `/reject` `{reason}` · `/offline-payment` `{method, reference}`
- Payments: `GET /payments` (filters incl. `awaitingReview=true`) · `GET /payments/summary` · `GET /payments/:ref` · `POST /payments/:ref/confirm` ·
  `POST /payments/:ref/reject` · `POST /payments/reconcile` · `GET /payments/:ref/receipt.pdf`
- Expenses: `GET /expenses/categories` · `GET|POST /expenses` · `GET|DELETE /expenses/:ref`
- Events: `GET /events?past=` · `POST /events` · `GET|PATCH /events/:id` · `POST /events/:id/cancel`
- Comms: `GET|POST /announcements` · `DELETE /announcements/:id` · `GET|POST /broadcasts` `{subject, body, audience, channels}` ·
  `GET /broadcasts/audiences` · `GET|POST /resources` (multipart) · `GET /resources/:id/download` · `DELETE /resources/:id`
- `GET /reports` · `GET /reports/:key?format=json|csv&from=&to=` · `GET /audit?target=&q=`
- Settings: `GET /settings` · `PUT /settings/tiers/:name` · `PUT /settings/fees` · `PUT /settings/bank-account`
- Staff: `GET|POST /staff` · `PATCH /staff/:id` · `POST /staff/:id/resend-invite`

**Webhooks** `POST /api/webhooks/payments/:provider` (signature-checked raw body). **Health** `GET /health` (ready: the database answers) and `GET /health/live` (the process is up).

## Connecting the UI

**Done:** every page uses the API through `src/api.js` and `src/checkout.js`: the public website, sign-in and
set-password, the Secretariat console (`src/admin.js`) and the member portal (`src/member.js`). The prototype's
`localStorage` demo store has been removed. For reference, this is how the prototype was moved over:

1. Add a small API client (base URL from `import.meta.env.VITE_API_URL`, bearer token, refresh on 401).
2. Have each route load its data before rendering. The router in `src/main.js` can `await` a page's loader and then render.
3. Replace mutations (`commit()`, `S.x.push`) with API calls, then re-fetch.
4. Changes the UI needs:
   - **Card payments**: the prototype collects card numbers. Use the gateway's hosted checkout instead (open `checkoutUrl`).
   - **Payment status**: instead of the simulated 2.6 s timer, poll `GET …/payments/:ref` until it leaves `PENDING`.
   - **Bank transfers**: start the payment, then upload the proof to `…/payments/:ref/proof`.
   - **Tracking**: the track page needs the `?t=` token from the emailed link, with a "resend my link" form as the fallback.
   - **New screens**: set password (`#/set-password?token=`), plus the credit-check consent and purpose fields.
   - **MoF expiry**: the officer enters the expiry date when recommending.
   - **Stage names** are upper-case (`MOF_REVIEW`). A recommended application shows `displayStage: AWAITING_APPROVAL`.

## Before production

These are simulated or stubbed behind interfaces in `src/providers/` and need real integrations:

- **Payment gateway** (MTN/Airtel/Zamtel mobile money, card, iZyane Pay QR): implement `PaymentProvider` and set `PAYMENT_PROVIDER`. The adapter must use the payment `ref` as its idempotency key and
  must not retry without it; `initiate()` already times out (`PAYMENT_INITIATE_TIMEOUT_SECONDS`) and honours late successes
  (see `docs/architecture.md`, "Payment gateway failures"). The sandbox
  settles payments after `SANDBOX_SETTLE_SECONDS`; a number ending in `0000` is declined.
- **SMS gateway** (`SmsSender`). Email works with any SMTP server via `SMTP_URL`; without it, messages are logged.
- **Credit bureau API** (`CreditBureau`), plus the bureau's terms on consent and permissible purpose.
- **ZRA TPIN lookup**: the application check currently validates the format only (`checks()` in `services/applications.ts`).
- **Documents**: set `STORAGE_DRIVER=s3` for any S3-compatible bucket.
- Run behind HTTPS. Set `CORS_ORIGINS` and `PUBLIC_APP_URL` to the deployed UI, and use strong `JWT_SECRET`/`WEBHOOK_SECRET`
  (the server refuses to start in production with the placeholders).

Known upstream noise: Prisma 7's `adapter-pg` triggers a `pg` deprecation warning ("client.query() when the client is already
executing a query") for some nested reads inside transactions. It is harmless on `pg` 8; check before upgrading to `pg` 9.

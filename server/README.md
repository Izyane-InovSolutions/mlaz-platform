# MLAZ platform API

Backend for the Money Lenders Association of Zambia membership platform (the prototype UI in `../src`).
Node.js 22+, TypeScript, Fastify 5, PostgreSQL, Prisma 7.

## Run it

```bash
cd server
cp .env.example .env          # then set JWT_SECRET and WEBHOOK_SECRET
npm install                   # also generates the Prisma client
npm run db:up                 # PostgreSQL in Docker on localhost:5435 (+ a mlaz_test database)
npm run db:deploy             # apply migrations
npm run db:seed               # demo data (same members/applications as the prototype)
npm run dev                   # http://localhost:3000, background jobs included
npm test                      # 51 API tests against mlaz_test
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
  index.ts          starts the server and the background jobs
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

### Security notes

- Passwords are hashed with argon2id. Access tokens (JWT, 15 min) go in the `Authorization: Bearer` header; refresh tokens rotate
  on every use, and replaying an old one revokes all of that user's sessions.
- Applicants have no account. Their tracking link carries an HMAC token derived from the reference, so sequential references
  (`APP-2042`) can't be enumerated. Send it as `x-tracking-token` or `?t=`.
- Uploads: PDF/JPG/PNG only, detected from the file's bytes; 10 MB limit; stored under server-generated keys.
- Rate limits on login, password reset, applications, verification and credit checks. CSV exports neutralise spreadsheet formulas.

## API

All endpoints are under `/api`. Errors look like `{ "error": { "code": "...", "message": "...", "details": ... } }`.
Money is a number in kwacha; dates are ISO strings (calendar dates come back as `YYYY-MM-DDT00:00:00.000Z`).

**Auth** `/api/auth`: `POST /login` `{email, password, portal?: 'staff'|'member'}` · `POST /refresh` · `POST /logout` · `GET /me` ·
`POST /password/forgot` · `POST /password/set` `{token, password}` (invite and reset links) · `POST /password/change`

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

**Webhooks** `POST /api/webhooks/payments/:provider` (signature-checked raw body). **Health** `GET /health`.

## Connecting the UI

**Done:** the public website, sign-in, set-password pages and the Secretariat console (`src/admin.js`) use the API
through `src/api.js` and `src/checkout.js`.
**Next:** the member portal (`src/member.js`), which still reads demo data.

The prototype keeps state in `localStorage` (`src/store.js`) and reads it synchronously from every page. To integrate:

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

- **Payment gateway** (MTN/Airtel/Zamtel mobile money, card, iZyane Pay QR): implement `PaymentProvider` and set `PAYMENT_PROVIDER`. The sandbox
  settles payments after `SANDBOX_SETTLE_SECONDS`; a number ending in `0000` is declined.
- **SMS gateway** (`SmsSender`). Email works with any SMTP server via `SMTP_URL`; without it, messages are logged.
- **Credit bureau API** (`CreditBureau`), plus the bureau's terms on consent and permissible purpose.
- **ZRA TPIN lookup**: the application check currently validates the format only (`checks()` in `services/applications.ts`).
- **Documents**: set `STORAGE_DRIVER=s3` for any S3-compatible bucket.
- Run behind HTTPS. Set `CORS_ORIGINS` and `PUBLIC_APP_URL` to the deployed UI, and use strong `JWT_SECRET`/`WEBHOOK_SECRET`
  (the server refuses to start in production with the placeholders).

Known upstream noise: Prisma 7's `adapter-pg` triggers a `pg` deprecation warning ("client.query() when the client is already
executing a query") for some nested reads inside transactions. It is harmless on `pg` 8; check before upgrading to `pg` 9.

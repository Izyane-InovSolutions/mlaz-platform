# MLAZ Platform: Operations and deployment runbook

For whoever deploys and runs the platform. Architecture: [architecture.md](architecture.md) ("Operations" covers
probes, timeouts and the production checklist enforced at startup). This page covers deployment, configuration,
backups, monitoring, external integrations, the procedures around them, and what happens when something fails.

**Status (4 November 2026): not production-ready.** The code is prepared for production hosting, but no production
infrastructure exists yet: no API host, database server, document bucket, backup storage or monitoring service has been
chosen or provisioned. The payment gateway, SMS gateway, credit bureau and ZRA TPIN lookup are not connected. See
"Go-live status" at the end of this page.

Status labels used on this page:

| Label | Meaning |
| --- | --- |
| **Done** | Implemented and tested in this repository. |
| **Ready, needs configuration** | Implemented; works once an account, credential or setting outside the repository exists. |
| **Manual setup** | Infrastructure someone must provision or configure by hand. |
| **Decision needed** | Needs a business or provider decision before anything can be built or configured. |
| **Not implemented** | Nothing exists yet. |

## Environments and branches

`preview`, `staging` and `main` are **not interchangeable**, and nothing may be merged between them without the plan
below.

| Branch | What it holds (November 2026) |
| --- | --- |
| `preview` | The current platform: UI plus the API in `server/` (modular monolith). The November refactor and this production-readiness work are **not committed yet** (working tree only). |
| `feat/backend` | An older line of the API; `preview` contains all of it. |
| `staging` | The October prototype UI (`src/*.js`, no `server/`), plus a Supabase experiment (`ea4b608`) and an MLAZ logo rebrand (`ab3709e`, `9910ed5`, `f69ef64`). 5 commits that `preview` does not have. |
| `main` | `staging`'s history, then a revert of the API merge (`269bc9d`), the logo again (`9a447d1`) and the Supabase code removed again (`fe9f566`). `preview` already contains the revert commit. |

Common ancestor of `preview` and `staging`: `73face4` (12 October 2026). A trial merge (`git merge-tree`, which
changes nothing) of `origin/staging` into `origin/preview` conflicts in 9 files (`.env.example`, `.gitignore`,
`README.md`, `package-lock.json`, `src/admin.js`, `src/main.js`, `src/public.js`, `src/store.js`, `src/ui.js`), and
`origin/main` into `origin/preview` in 4 (`.gitignore`, `README.md`, `src/main.js`, `src/ui.js`). Once the refactor is
committed these become modify/delete conflicts, because `preview` deletes those UI files.

**What `staging` has that `preview` lacks.** Only two things are worth keeping:

- **The MLAZ logo:** `public/mlaz-logo.png` (the `f69ef64` version), used as favicon and apple-touch icon, and in place
  of the shield icon in the public header, the footer and the console sidebar, sized by `.brand-logo { width: 38px;
  height: 38px; flex-shrink: 0; }`. `favicon.svg` was removed.
- **Nothing else.** The Supabase experiment (direct database access from the browser) is replaced by the API; its schema
  and client must not come back. The `src/*.js` prototype files no longer exist in `preview`.

**Can `preview` replace `staging`?** Yes, once the logo is carried over: every other `staging` change is superseded.
But `staging` is a different architecture: the API, a database and the API's environment variables must exist before a
`preview` build can work on the staging site (see "Deploying a release").

**Recommended branch strategy.**
`main` holds production (protected, CI required). `staging` holds the next release, deployed to the staging site, and
receives `preview` by pull request. Feature branches are merged into `preview` (or straight into `staging`) by pull
request. Nothing is force-pushed or deleted. The steps below are a plan only: they need approval, and none has been run.

1. Commit the current `preview` working tree (the refactor plus this work) and push `preview`.
2. Carry the logo over on a branch from `preview`:
   ```bash
   git fetch origin
   git switch -c chore/mlaz-logo origin/preview
   git checkout f69ef64 -- public/mlaz-logo.png
   git rm public/favicon.svg
   # then, by hand: index.html icon links; brand markup in src/features/public/layout/layout.js and src/app/shell.js;
   # .brand-logo in src/styles/styles.scss (see the bullet above). Run npm run check:full and the E2E suite.
   ```
   Open a pull request into `preview`.
3. Record `staging` as merged without taking its tree, on a branch from the updated `preview`:
   ```bash
   git switch -c release/staging-sync origin/preview
   git merge -s ours origin/staging -m "Merge staging: superseded by the API architecture (logo carried over in chore/mlaz-logo)"
   ```
   `-s ours` keeps `preview`'s files exactly and makes `staging` an ancestor, so the next step is a fast-forward, not
   a force-push. Open a pull request from `release/staging-sync` into `staging`. Its diff is the whole new
   architecture; review it as such. Merging it fast-forwards `staging`.
4. Do the same for `main` when production is ready (`git merge -s ours origin/main` on a branch from `staging`; pull
   request into `main`). `main`'s own commits are the logo and the Supabase removal, both already accounted for.
5. Before merging into `staging` or `main`, check the Vercel project (below) so the merge does not deploy a UI that
   has no API behind it.

**Vercel (not visible from the repository; check in the Vercel dashboard).** Which branch is the Production Branch;
whether `staging` and `preview` get preview deployments; and the environment variables per environment
(`VITE_API_URL` for each). A Production build now **fails** unless `VITE_API_URL` is an `https://` URL (see "Content
Security Policy").

## Topology

| Part | Runs on | Notes |
| --- | --- | --- |
| UI | Vercel (static, `npm run build` -> `dist/`) | Security headers and CSP in `vercel.json`; `VITE_API_URL` set at build time. |
| API | **Decision needed**: any host that runs a container or a long-lived Node 24 process | `server/Dockerfile` builds it. One process = HTTP + background jobs; several instances are safe. |
| Database | PostgreSQL 17, **Decision needed** (a managed service with point-in-time recovery is recommended) | The only shared state: sessions, throttles, job leases and the outbox live here. |
| Documents | S3-compatible bucket (`STORAGE_DRIVER=s3`), **Manual setup** | Private, server-side encryption, versioning on, never public. `local` is for development only. |
| Backups | `ops/backup/` runner + a separate bucket, **Manual setup** | See "Backups and recovery". |

## API hosting

**Done:** the API reads `PORT` and `HOST` (default `0.0.0.0:3000`) from the environment. It has a liveness probe
(`GET /health/live`) and a readiness probe (`GET /health`: 503, with no infrastructure details, when the database does
not answer within 2 s). It refuses to start in production on unsafe settings (see "Configuration"). It never runs
migrations on start.

On SIGTERM it shuts down gracefully:
1. It stops the scheduler, cutting an email batch short between two messages; unsent messages return to the queue uncounted.
2. New requests get 503 while the requests in progress finish.
3. It closes the database pool.
4. A 25 s backstop forces exit 1.

**Container image (Done, built and run locally):** `server/Dockerfile`.

- `docker build -t mlaz-api server` builds the API: Node 24 (build argument `NODE_VERSION`), production dependencies
  only, runs as the unprivileged `node` user, `node dist/index.js` as PID 1, so SIGTERM reaches it. Its Docker
  `HEALTHCHECK` uses `/health/live`.
- `docker build -t mlaz-api-migrate --target migrate server` builds the migration job: `prisma migrate deploy`, then
  exit.
- CI, local development (`.nvmrc`), the API and migration images and the backup runner all use Node 24. Change them
  together.

**Host requirements**, whatever the provider:

- Runs the image (or `npm ci && npm run build` in `server/`, then `node dist/index.js`); restarts the process when it
  exits non-zero.
- TLS terminated in front, with `TRUST_PROXY_HOPS` set to the number of proxies (production refuses to start if it is
  unset). Without it every client shares one rate-limit bucket and the audit trail records the proxy's address.
- Readiness probe `GET /health`, liveness probe `GET /health/live`, stop grace period at least 30 s.
- Upload limits on the proxy: body size 42 MB, request buffering off, body timeout 60 s, read timeout 150 s (nginx:
  `client_max_body_size`, `proxy_request_buffering off`, `client_body_timeout`, `proxy_read_timeout`).
- Instances × `DB_POOL_MAX` (default 10) below the database's `max_connections`, with room for migrations and an
  operator session.
- A private network path to the database (not a public database endpoint) if the provider supports it.
- Secrets in the provider's secret store.

**Provider options (Decision needed).** These are examples of hosts that meet the requirements. None is chosen,
nothing is provisioned, and each costs money.

| Kind | Examples | Fit |
| --- | --- | --- |
| Managed container platform | Render, Railway, Fly.io, Google Cloud Run (min. instances ≥ 1, CPU always allocated), Azure Container Apps | Least operations work. Runs `server/Dockerfile`; the migrate target runs as a release/pre-deploy job. Cloud Run needs CPU always allocated, or the background jobs stop between requests. |
| Container service on a cloud | AWS ECS Fargate + ALB, Azure App Service for containers | More setup; fits an organisation already on that cloud. |
| A virtual machine | Any Linux VM with Docker, systemd and nginx/Caddy | Cheapest; MLAZ then patches the OS, renews TLS and watches the disk. |

Hosting near Zambia (South Africa regions, for example `af-south-1` or `southafricanorth`) shortens round trips; check
data-protection requirements for personal data stored outside Zambia before choosing a region (**Decision needed**).

### Deploying a release

1. CI is green on the commit (lint, types, UI/API/security tests, builds, audit, E2E).
2. Take an on-demand backup (`pg-backup.sh`) or note the time for point-in-time recovery.
3. Build both images from that commit and tag them with the commit SHA.
4. **Migrations, once, from one place:** run the `migrate` image with the production `DATABASE_URL` as a release
   step. It exits 0 when every migration has been applied. Never run it from each instance.
5. Deploy the API image: replace instances one at a time (rolling), each passing `/health` before the next. Exception:
   `20261021120000_session_lifetime_and_login_challenge` is not safe for a rolling deploy; replace all instances at
   once, at a quiet time.
6. Deploy the UI (Vercel builds from the branch; `VITE_API_URL` must name this API).
7. Check: `/health` is 200 and `/health/status` is "ok" with the monitoring token; sign in to the console; open a
   member and a payment. Watch error logs for 15 minutes.

Before a release, check for drift on staging: against a database migrated to the previous release,
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` must print an empty
migration after the new migrations are applied.

### Rollback

- **App only (no migration in the release):** redeploy the previous image tag and UI build.
- **Release with an additive migration** (new tables, columns or indexes, like every migration so far except the
  session one): roll the app back; the previous version ignores what was added. Leave the schema as it is.
- **A migration that removes or rewrites data:** none exists yet. Such a release must ship in two steps (expand, then
  contract) so the app can always roll back one step without restoring.
- **Restoring the database** is the last resort: it loses every payment, application and audit entry since the
  backup. See "After restoring production".

## Configuration and secrets

Every variable is validated at startup (`server/src/config.ts`; the full list with comments is in
`server/.env.example`). Production refuses to start when any of these holds:
- a placeholder or shared secret
- insecure cookies
- non-https origins
- no SMTP server
- `REQUIRE_STAFF_2FA` off
- `TRUST_PROXY_HOPS` unset
- the sandbox gateway or the simulated credit bureau without `ALLOW_SANDBOX_IN_PRODUCTION=true` (a staging site only)
- `SMS_DRIVER=log`, which delivers nothing and writes phone numbers and message text to the log

Secrets never appear in logs (see "Logging").

Variables added for production readiness:

| Variable | Default | Production value |
| --- | --- | --- |
| `SMS_DRIVER` | `log` | `none` until an SMS gateway is connected (`log` is refused). |
| `BUREAU_DRIVER` | `simulated` | `none` until a bureau is connected (`simulated` is refused unless `ALLOW_SANDBOX_IN_PRODUCTION=true`). |
| `BUREAU_TIMEOUT_SECONDS` | 10 | Longest wait for one bureau lookup (1–15). |
| `MONITORING_TOKEN` | empty (endpoint off) | 32+ random characters; enables `GET /health/status`. |
| `STORAGE_SWEEP` | `report` | `report` at first; `delete` once reports have been reviewed (see "Document storage integrity"). |
| `STORAGE_ORPHAN_GRACE_HOURS` | 24 | Files younger than this are never treated as orphans (2–720). |

Production environment, minimum: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY`,
`WEBHOOK_SECRET` (three different 48-byte random values), `REQUIRE_STAFF_2FA=true`, `TRUST_PROXY_HOPS`,
`CORS_ORIGINS` and `PUBLIC_APP_URL` (the UI's https origin), `SMTP_URL`, `EMAIL_FROM`, `STORAGE_DRIVER=s3` with
`S3_BUCKET`/`S3_REGION`/credentials, `SMS_DRIVER=none`, `BUREAU_DRIVER=none`, `MONITORING_TOKEN`. The payment variables
are outside this document's scope; the sandbox is refused in production.

- Keep secrets in the host's secret store, never in the repository (Gitleaks runs in CI and before each push).
- Rotating secrets has consequences:
  - `JWT_SECRET`: everyone is signed out. Emailed applicant tracking links stop working; applicants can ask for a new
    one from the tracking page.
  - `DATA_ENCRYPTION_KEY`: every two-factor enrolment becomes unreadable. Staff must be reset by an admin and enrol
    again. Treat it as permanent, and keep a copy with the backup keys: a restored database is useless for staff
    two-factor sign-in without it.
  - `WEBHOOK_SECRET`: rotate together with the gateway's configuration.
- `CORS_ORIGINS` lists exactly the deployed UI origins (https only, no wildcards; production refuses anything else).

### Content Security Policy (UI)

**Done.** `vercel.json` sends the full policy as a header. It cannot read environment variables, so its `connect-src`
is `'self' https:`. Every build therefore also writes a second policy into `index.html` as a `<meta>` tag:
`connect-src 'self' <origin of VITE_API_URL>`. Browsers enforce both policies, so the page can connect only to itself
and to that one API origin. A Vercel Production build fails if `VITE_API_URL` is missing or not `https://`.
`test/csp.test.mjs` checks all of this, and the E2E suite fails on any CSP violation (also in
`E2E_UI_MODE=preview`, which serves the built bundle under the production header).

When the API's domain is fixed (**Manual setup**), also replace `https:` in `vercel.json` with that origin and add
`report-uri https://<api-domain>/api/csp-report`. A `<meta>` policy cannot carry `report-uri`, so violation reports
need the header.

Other directives (reviewed November 2026), each limited to what the UI uses:
- `img-src data: blob:`: QR codes and document previews
- `frame-src blob:`: PDF previews
- `font-src data:`: bundled icon fonts
- `worker-src 'none'`
- `form-action 'self'`
- `style-src 'self'` (production)

## Database

### Migrations

Forward-only SQL in `server/prisma/migrations`, applied by the `migrate` image (or `npm run db:deploy` in `server/`)
as a release step. Per-migration notes:

- `20261021120000_session_lifetime_and_login_challenge` signs everyone out and is not safe for a rolling deploy.
- `20261103090000_hot_query_indexes` adds three indexes and drops one superseded index. `CREATE INDEX` blocks writes
  to `Payment`, `AuditLog` and `MofRenewal` while it builds; at today's sizes that is well under a second. On a large
  database, create the indexes `CONCURRENTLY` by hand first and mark the migration applied
  (`prisma migrate resolve --applied 20261103090000_hot_query_indexes`).

### Backups and recovery

Two layers, because each covers the other's failure:

1. **Point-in-time recovery (PITR) on the database host (Manual setup).** Continuous WAL archiving by the managed
   PostgreSQL service, at least **30 days**, restoring to any second in that window. This is the main recovery path;
   managed services encrypt these backups at rest. If MLAZ runs its own PostgreSQL instead, use pgBackRest or WAL-G
   with an off-site repository to get the same.
2. **Daily logical dumps kept away from the database host (Ready, needs configuration).** `ops/backup/pg-backup.sh`
   does the following:
   - dumps with `pg_dump -Fc`
   - checks that the archive is readable and contains the application's tables
   - encrypts it with GPG to a **public** key, whose private key is kept offline, so the backup runner can write
     backups but never read them
   - writes a manifest: SHA-256, size, latest migration
   - copies both files to an S3-compatible bucket at another provider or region
   - prunes local copies
   - POSTs to `BACKUP_ALERT_WEBHOOK` on any failure and calls `BACKUP_HEARTBEAT_URL` on success

   `ops/backup/Dockerfile` packages it with the PostgreSQL 17 client tools; run it daily (cron, a Kubernetes CronJob or
   a scheduled container). `ops/backup/check-backup-freshness.sh`, run from somewhere else, fails and alerts when the
   newest complete backup is older than 26 hours.

**Retention.**
- PITR: 30 days.
- Daily dumps: 35 days.
- Monthly: the first dump of each month kept 12 months.
- Yearly: the first dump of each year kept 7 years (financial records; confirm the legal period with MLAZ, **Decision
  needed**).

Retention is enforced by the backup bucket's lifecycle rules, not by the script. Turn on object lock (WORM) or
versioning so that whoever holds the runner's credentials cannot delete or overwrite backups. The runner's key may only
`PutObject` to its prefix.

**Protection.**
- Backups are encrypted before they leave the runner.
- The bucket is private, encrypted at rest, and in a different account or provider from production.
- The database role used for dumps is read-only.
- The GPG private key and `DATA_ENCRYPTION_KEY` are kept offline in two places (for example a password manager vault
  and a sealed copy), held by two named people.
- Store credentials in the scheduler's secret store.

**Documents.** The bucket holding documents needs versioning (30 days of non-current versions) and replication to
another region or provider (**Manual setup**). The database stores keys, the bucket the files; a restore needs both
from about the same time.

**Not operational yet.** No production backup exists. The scripts were proven once, on 3–4 November 2026, against the
local development database (record below). That shows the tooling works; it is not a production backup. Production
backups count as operational only after the first scheduled run has reached the off-site bucket **and** a drill has
restored it.

### Restore drill

**Quarterly, and after any change to the backup setup.** `ops/backup/restore-drill.sh <file>` does the following:
- checks the file against its manifest's checksum
- decrypts it (the private key must be present on the drill machine only)
- creates a **new** database named `mlaz_restore_*` (it refuses an existing one)
- restores into it
- prints row counts of the main tables and checks the latest migration against the manifest

With `SERVER_DIR` set, it also runs `prisma migrate status` and starts the API against the restored database with jobs
off, then checks `/health` and reads `/api/public/directory`. Afterwards:
1. Sign in to the console against it and open a member and a payment.
2. Record the date, backup used, duration and result below.
3. Drop the database (the script does this unless `KEEP_RESTORED_DB=true`).

Use a separate database server for the drill, never production's.

| Date | Backup | Result |
| --- | --- | --- |
| 2026-11-04 | Local development database (not production), `mlaz-20261103T135148Z.dump.gpg`, 39.7 kB, encrypted with a throwaway drill key | **Passed.** The backup was dumped, verified and encrypted (~4 s). It was then checksum-checked, decrypted and restored into a separate PostgreSQL 17 server (4 s), with counts matching the source: 14 users, 10 members, 5 applications, 8 payments, 22 documents, 81 audit entries. The `migrate` image applied the 2 newer migrations. The production API image started in production mode against the restored database: `/health` 200, the public directory read 9 members, and a member signed in (a session was written). The drill server and keys were deleted afterwards. |

### After restoring production

1. Keep the API stopped or `JOBS_ENABLED=false` on every instance.
2. Restore documents from bucket versions to the same point in time.
3. Run payment reconciliation before re-enabling jobs: the gateway may have settled payments the restored database
   thinks are pending.
4. Leave `STORAGE_SWEEP=report` until the bucket and database agree. Files uploaded after the restore point are
   otherwise orphans; the sweep refuses to delete more than 200 at once anyway.
5. Tell members that changes since the restore point are lost; check the audit log's last entries.

## Monitoring and alerting

### Logging (Done)

- **Format.** One structured JSON log on stdout, with `service: "mlaz-api"`. Every request log line, and every line a
  module writes while serving that request, carries `reqId`, which the client also receives in `x-request-id`.
  Background jobs log without one.
- **Redaction.** Logs never contain:
  - credentials, tokens, session ids, MFA codes or recovery codes
  - NRC numbers or credit reports
  - one-time links: `?token=` and `?t=` are scrubbed from URLs and message text
  - message bodies or recipients
  - document contents

  Redaction is applied centrally (`server/src/shared/log.ts`) as a safety net. Unexpected 500s log their stack; the
  client sees only the request id.
- **Shipping.** Logs go to the host's log store. If it cannot alert on log queries, ship them to a log service that can
  (**Decision needed**: for example Better Stack, Grafana Cloud, Datadog or New Relic; none is set up, and log-shipping
  credentials go in the host's secret store).

Operational events carry an `event` field to count and alert on:

| Event | Level | Meaning |
| --- | --- | --- |
| `http.unhandled_error` | error | A 500: a bug or an unexpected failure. |
| `job.failed` | error | A background job step failed (`job`, `consecutiveFailures`). |
| `job.nightly_failures` / `job.reminder_failed` | error | Nightly membership rules partly failed; retried the next night. |
| `outbox.send_failed` / `outbox.gave_up` | error | An email or SMS attempt failed / was given up after 5 attempts. |
| `storage.failed` | error | A document storage call failed after its retries. |
| `storage.missing_files` / `storage.sweep_refused` | error | Records without files / a sweep found too many orphans. |
| `storage.orphans_found` | warn | Files without records (report mode). |
| `bureau.lookup_failed` | error | The credit bureau did not answer in time or failed. |
| `payment.initiate_failed` / `payment.query_failed` | error | The gateway did not accept a payment / a status query failed. |
| `auth.sign_in_failed` | warn | Wrong password, unknown account or deactivated account (`userId` when known, `ip`). |
| `auth.mfa_failed` | warn | Wrong authenticator or emailed code. |
| `auth.throttled` | warn | A sign-in or code attempt was refused by a throttle (`throttle`: ip, account, mfa-step…). |
| `auth.challenge_mode_on` | warn | An account started asking unknown devices for an emailed code after repeated failures. |
| `auth.refresh_token_reuse` | error | A refresh token was used twice: probable token theft; all of the user's sessions were ended. |
| `health.database_unavailable` / `health.status_failing` | warn / error | A probe found the database down / a status check failing. |

### Health and status endpoints

- `GET /health/live` (liveness) and `GET /health` (readiness, checks the database). Unauthenticated, never rate
  limited, no details beyond "not ready".
- `GET /health/status` (**Ready, needs configuration**: set `MONITORING_TOKEN`). Call it with
  `Authorization: Bearer <MONITORING_TOKEN>`. It returns 200 with `status` "ok" or "degraded", or 503 with "failing",
  plus counts only:
  - `database`
  - `outbox`: overdue messages fail it; messages failed in the last 24 h degrade it
  - `payments`: gateway payments pending over 30 minutes degrade it
  - `nightly`: the run is missing after 02:00 Lusaka time
  - `jobs`: on this instance, a job with 3 consecutive failures, or no outbox success for 5 minutes
  - `integrations`: each one's state; a simulated integration on a production server degrades it

  With several instances, point the monitor at each, or at the one running jobs.

### Alerts (thresholds to configure, Manual setup)

| Alert | Source | Threshold | Severity |
| --- | --- | --- | --- |
| API down | External uptime check on `https://<api>/health` | 2 consecutive failures, 1-minute interval, from 2 locations | Critical, page |
| Status failing | Uptime check on `/health/status` with the token | 503 for 5 minutes | Critical, page |
| Status degraded | Same, keyword check for `"degraded"` | 30 minutes | Warning, ticket |
| 5xx rate | Logs: `res.statusCode >= 500` | > 1% of requests over 5 minutes, or > 10 in 5 minutes | Critical |
| Slow responses | Logs: `responseTime` on "request completed" lines | p95 > 2 s over 10 minutes (uploads and exports excluded) | Warning |
| Database down | `/health` 503 or `health.database_unavailable` | Any, for 2 minutes | Critical, page |
| Background job failing | `job.failed` with `consecutiveFailures >= 3` | Any | Critical |
| Email delivery | `outbox.gave_up`, or status `outbox` | Any given-up message; overdue > 0 for 15 minutes | Warning; critical if overdue |
| Storage | `storage.failed` | > 5 in 10 minutes | Critical |
| Document integrity | `storage.missing_files`, `storage.sweep_refused` | Any | Critical |
| Brute force | `auth.sign_in_failed` | > 50 per 10 minutes overall, or > 20 from one `ip` | Warning |
| Account under attack | `auth.challenge_mode_on` | Any | Warning (the audit log names the account) |
| Token theft | `auth.refresh_token_reuse` | Any | Critical: contact the user |
| Backups | `BACKUP_ALERT_WEBHOOK`, freshness check, heartbeat missed | Any failure; no backup in 26 h | Critical |

**Escalation (Decision needed: names and rota).**
1. The on-call engineer acknowledges a critical alert within 15 minutes in working hours, or 1 hour outside them.
2. If it is not resolved within 1 hour, the engineer informs the Secretariat Admin, who decides whether to tell members.
3. Suspected data loss or a security incident (token theft, mass sign-in failures followed by success, missing files)
   goes at once to the technical lead and MLAZ management. Record what was seen, keep the logs, and follow the
   data-protection notification rules that apply.
4. After the incident, write a short note: cause, impact, fix, follow-up.

## External integrations

Each integration's state shows on the console's Settings page and in `/health/status`. The server decides it
(`server/src/shared/integrations.ts`); nothing reports an integration as connected unless it is.

| Integration | State | What exists | What is needed |
| --- | --- | --- | --- |
| Email (SMTP) | **Ready, needs configuration** | SMTP adapter with connect, socket and send timeouts; durable outbox (see "Email delivery"). | An SMTP provider, `SMTP_URL`, and SPF/DKIM/DMARC on the sending domain. |
| SMS gateway | **Not implemented; Decision needed** | `SmsSender` interface (`communications/infrastructure/messaging.ts`) and the outbox's SMS channel. `SMS_DRIVER=none` queues no SMS; an SMS queued before is failed with the reason, never marked sent. `log` is for development and refused in production. | A provider chosen by MLAZ (and a registered sender ID), its API documentation and credentials. |
| Credit bureau | **Not implemented; Decision needed** | `CreditBureau` interface (`lending/infrastructure/bureau.ts`). The use case enforces consent, purpose, daily cap, audit, a per-member lock and a deadline (`BUREAU_TIMEOUT_SECONDS`). A failed or slow lookup returns 503 and is neither recorded nor counted. Simulated reports are labelled "Simulated report" to the member. `BUREAU_DRIVER=none` returns 503 "not connected". | A bureau contract (for example with a credit reference bureau licensed by the Bank of Zambia), its API documentation, credentials and consent terms. |
| ZRA TPIN lookup | **Not implemented; Decision needed** | Format check only (10 digits); officers see "ZRA register lookup is not connected yet; confirm manually". | Whether ZRA offers MLAZ a lookup API, and on what terms; its documentation and credentials. |
| Payment gateway | Out of scope for this document | — | — |

**Requirements for each future adapter.** They follow the existing SMTP and S3 adapters:
- Implement the interface in the module's `infrastructure/`, selected by its `*_DRIVER` variable, and map that driver
  to `live` in `shared/integrations.ts`.
- Validate requests before sending and responses before returning (a schema per response; anything else is an error).
- Put an overall deadline on every call, including connect and read timeouts.
- Retry only idempotent calls, and only on timeouts, 429 and 5xx, with backoff and jitter (at most 3 tries).
  - SMS: send at most once per outbox attempt; use the provider's idempotency key or our notification id if it has one.
  - Bureau: never retry automatically; each enquiry may be billed and appears on the borrower's file.
- Log with an `event` field, never personal data or credentials.
- Test against a local fake HTTP server (like the S3 timeout tests). Tests never call the real provider.
- Keep credentials in the secret store, and add a production check that refuses missing ones.

## Email delivery

**Done.** Emails are written to the `Notification` outbox in the same transaction as the change they report, so a
message exists if and only if the change committed. The outbox job then works as follows:
- It claims due messages with `FOR UPDATE SKIP LOCKED` and a 5-minute lease, so several instances never send one
  message at the same time.
- It sends serially, each send bounded by `SMTP_SEND_TIMEOUT_SECONDS`.
- It retries a failure after 2, 4, 8 and 16 minutes, then marks it FAILED (listed under Settings > Message delivery,
  with a manual retry).
- Once a message is sent, it scrubs the one-time links from the stored copy.

Duplicates: delivery is at least once. If the process dies after the mail server accepted a message but before it was
marked sent, that message goes out again when its lease expires. This is rare (one message per crash) and is preferred
to losing messages. Shutdown no longer causes it: stopping cuts a batch short between messages (tested in
`server/test/operations.test.ts`). An outbox is the right pattern here; no other queue is needed.

## Document storage integrity

**Done (report mode by default).** Files are stored before the transaction that records them and removed again if
that transaction fails. A crash between the two leaves a file without a record (an orphan). A daily sweep (02:00 Lusaka
time, one instance, `STORAGE_SWEEP`) compares the bucket with the `Document` table:

- Files with no record are reported (`storage.orphans_found`). With `STORAGE_SWEEP=delete` they are removed, but only
  if all of the following hold:
  1. Older than `STORAGE_ORPHAN_GRACE_HOURS` (24 h), so an upload whose request is still running is never touched.
  2. Named the way this server names files (`<kind>/<year or seed>/<uuid>.<pdf|jpg|png>`); anything else in the
     bucket is never touched.
  3. Still without a record when checked again just before removal.
  4. No more than 200 orphans in that run. More than that means a restored database or a wrong bucket; nothing is
     removed, and `storage.sweep_refused` is logged instead.
- Records whose file is missing are reported (`storage.missing_files`, with document ids) and never "repaired":
  restore the file from the bucket's versions.

Documents are never deleted by any other code (replaced ones are marked superseded). With bucket versioning on, a
removed orphan can still be recovered for the version-retention period. Recommended: run in `report` mode for the first
weeks in production, review the reported keys, then switch to `delete`.

## What happens when something fails

| Failure | What the platform does | Operator action |
| --- | --- | --- |
| API process crashes | Uncaught errors exit 1 after a clean shutdown; the manager restarts it | Investigate the `fatal` log line |
| Deploy stops an instance | Jobs stop between messages, requests in progress finish, 25 s backstop | None |
| Crash during a request | The transaction rolls back; files stored before it may remain as orphans | None; the daily sweep reports them |
| Crash while sending email | A claimed batch becomes due again after 5 minutes; a message sent but not yet marked sent goes out again | None |
| Mail server down | Each message retried at 2, 4, 8, 16 minutes, then FAILED; `/health/status` degrades | Retry from the console once fixed |
| Database unreachable | `/health` 503 (taken out of rotation); requests fail after `DB_CONNECT_TIMEOUT_SECONDS`; jobs log and retry | Restore the database; the pool reconnects |
| Storage unreachable | Uploads and downloads answer 503 after bounded retries; `storage.failed` logged | Check the bucket provider |
| Credit bureau down or slow | That check answers 503 after `BUREAU_TIMEOUT_SECONDS`; nothing recorded or counted | None; members retry |
| Instance dies holding the reconcile lease | The lease runs out within 3 minutes; another instance takes over | None |
| Nightly run interrupted | The day is already claimed; every rule catches up the next night; `/health/status` fails `nightly` | None, or run `runNightly()` by hand |
| Temporary upload files after a crash | Removed at the next start if older than an hour | None |
| Backup fails | `pg-backup.sh` exits non-zero and POSTs to `BACKUP_ALERT_WEBHOOK`; the freshness check alerts after 26 h | Fix and run it by hand |

## Go-live status

| Area | Item | Status |
| --- | --- | --- |
| API hosting | Port, probes, graceful shutdown, production config checks, container image, migration job | **Done** |
| API hosting | Choose the API host and region; create the service, TLS, DNS and secrets | **Decision needed**, then **Manual setup** |
| Database | Managed PostgreSQL 17 with PITR (30 days), private networking, backup role | **Manual setup** |
| Backups | Dump, encrypt, off-site copy, alerts, freshness check, restore drill scripts | **Done** (proven on development data) |
| Backups | Backup bucket, lifecycle and object lock, key custody, schedule, first production drill | **Manual setup** |
| Documents | S3 bucket with versioning and replication | **Manual setup** |
| Documents | Orphan sweep and missing-file report | **Done** (switch to `delete` after review) |
| Monitoring | Structured logs, request ids, redaction, event names, `/health/status` | **Done** |
| Monitoring | Monitoring/log service, uptime checks, alert rules, on-call rota | **Decision needed**, then **Manual setup** |
| UI | CSP `connect-src` limited to the built API origin; Production build requires an https API | **Done** |
| UI | API domain in `vercel.json` and `report-uri` | **Manual setup** (needs the domain) |
| Email | SMTP provider, domain authentication | **Ready, needs configuration** |
| SMS | Gateway adapter | **Not implemented; Decision needed** |
| Credit bureau | Bureau adapter and consent terms | **Not implemented; Decision needed** |
| ZRA TPIN | Lookup adapter | **Not implemented; Decision needed** |
| Payments | Real gateway adapter | Out of scope here; still **Not implemented** (the sandbox collects no money) |
| Branches | Commit `preview`, carry the logo over, sync `staging` and `main` by pull request | **Decision needed** (plan above) |
| Repository | Branch protection on `main` and `staging` requiring the CI checks | **Manual setup** (GitHub settings) |
| Runtime | Node 24 everywhere: `.nvmrc`, CI, `server/Dockerfile`, `ops/backup/Dockerfile` | **Done** |

# Browser end-to-end tests (Playwright)

The suite drives the real UI (Vite) against the real API (Fastify + Prisma) and a real PostgreSQL database, in
Chromium. It lives in `e2e/` and is configured in `playwright.config.ts`.

## Running it

One-time setup:

```bash
npm install                          # includes @playwright/test and pg
npm --prefix server install          # the API's dependencies (tsx, prisma)
npx playwright install chromium      # the browser
cd server && npm run db:up           # PostgreSQL 17 in Docker on localhost:5435
```

Then, from the repository root:

```bash
npm run test:e2e                     # the whole suite (about 3 to 5 minutes)
npm run test:e2e -- e2e/specs/06-dues.spec.ts      # one spec
npm run test:e2e -- --repeat-each=2  # check for flakiness
npm run test:e2e:report              # open the last HTML report (traces of failures included)
E2E_UI_MODE=preview npm run test:e2e # against the production build and its Content-Security-Policy (see below)
```

Playwright starts both servers itself and stops them at the end. Nothing else needs to be running, and a developer's
own `npm run dev` (API 3000, UI 5173, database `mlaz`) is left alone.

## Environment and isolation

| What | E2E value | Why |
| --- | --- | --- |
| Database | `mlaz_e2e` on the Docker PostgreSQL (port 5435) | Never `mlaz` (dev) or `mlaz_test` (API tests). Created if missing and migrated (`prisma migrate deploy`) by `e2e/support/prepare-db.mjs` before the API starts; the scripts refuse any other database name. |
| API | `http://localhost:3100`, started with `tsx src/index.ts` (no watch) | Edits to `server/src` during a run do not restart it. |
| UI | `http://localhost:5174` (`vite --strictPort`), `VITE_API_URL=http://localhost:3100/api` | `CORS_ORIGINS` and `PUBLIC_APP_URL` match it, so emailed links point at the e2e UI. With `E2E_UI_MODE=preview`, the production bundle is built and served instead (below). |
| Payments | `PAYMENT_PROVIDER=sandbox`, `SANDBOX_SETTLE_SECONDS=1`, `JOBS_ENABLED=true` | Payments settle through the background reconcile job (10-second tick). A mobile number ending `0000` is declined. |
| Email | `SMTP_URL` empty | Emails only go to the `Notification` outbox (see below). |
| Files | `STORAGE_DRIVER=local`, storage and upload temp folders under `node_modules/.cache/mlaz-e2e/` | Emptied before each run. |
| Credit bureau | `BUREAU_DRIVER=simulated`, `CREDIT_CHECKS_PER_DAY=3` | A small cap so the daily limit can be reached. |
| Secrets | e2e-only values in `e2e/support/env.ts` | Every variable in `server/.env` is overridden explicitly, so a developer's `.env` never leaks in. |

All settings are in `e2e/support/env.ts`. Ports and database can be moved with `E2E_API_PORT`, `E2E_UI_PORT`,
`E2E_DATABASE_URL` (must name `mlaz_e2e`) and `E2E_DB_ADMIN_URL`.

**Rate limits.** The API runs with `NODE_ENV=test`. That exempts every client from *all* HTTP rate limits: the global
one and the per-route ones too (the route limits inherit the global `allowList`; see `server/src/platform/http/app.ts`).
This is deliberate: the suite signs in dozens of times from one address, and the 10-per-5-minutes sign-in limit would
otherwise block it within one run. What still applies: the Postgres-backed sign-in throttles (a successful sign-in
hands its attempt back), the MFA attempt counters, the upload limits and the credit-check daily cap. The HTTP rate
limits themselves are covered by the API tests. `NODE_ENV=test` also turns off the API's request log.

**UI mode.** By default the UI is the Vite dev server. `E2E_UI_MODE=preview` runs `vite build` (with `VITE_API_URL` baked
in) into `node_modules/.cache/mlaz-e2e/dist`, so the repository's `dist/` is left alone, then serves it with
`vite preview --outDir <that folder> --port 5174 --strictPort --host 127.0.0.1`. `vite preview` sends production's
Content-Security-Policy (`vite.config.js`), including the strict `style-src` that the dev server has to relax for its
injected styles, so together with the CSP guard below the suite checks the production policy. The build adds about
half a minute to start-up. Any other value of `E2E_UI_MODE` is refused.

**Content-Security-Policy guard.** Every spec imports `test` and `expect` from `e2e/support/test.ts`, not from
`@playwright/test`. It adds one automatic fixture that listens to the browser console of the test's context, and of any
context the test opens with `browser.newContext()`, and fails the test if Chromium reports a Content-Security-Policy
violation (Chromium logs every blocked script, style, image, connection or frame as a console error naming the policy).
Nothing is added to the pages under test. The check runs after the test body, so a test's own failure is reported
first. New specs must import from `../support/test.ts` too.

**Data.** `e2e/global-setup.ts` runs `e2e/support/seed.ts` (with the server's `tsx`, using the API's own Prisma client
and password hashing, like `server/test/helpers.ts`). It truncates every table and inserts tiers, settings, counters,
eight staff accounts and thirteen members (`e2e/support/data.ts`), all with the password in `env.ts`. Each spec uses its own
accounts, so specs run in parallel (3 workers locally, 2 in CI) without sharing sessions, throttles or dues. Steps a
spec is not about (submitting, recommending, approving an application) go through the API (`e2e/support/api.ts`).
Upload files (a valid one-page PDF, a text file, a text file named `.pdf`) are built in memory (`e2e/support/files.ts`).

**Reading emails.** The outbox job marks each email sent within seconds and scrubs its one-time links (`?token=`,
`?t=`, sign-in codes) from the `Notification` row. So that tests can still follow set-password and tracking links, the
seed adds a trigger, **in `mlaz_e2e` only**, that copies every new `Notification` row into an `e2e_mail` table as it is
inserted. `e2e/support/db.ts` polls that table (`mailLink`, `setPasswordLink`, `trackingLink`). No application code
is involved. Pass `afterId: await lastMailId()` to `mailLink` to ignore emails captured before a step.

**Simulated time and attacks.** `e2e/support/db.ts` also has test-only helpers that change `mlaz_e2e` directly where the
API offers no way to get there from a browser: `ageSessionPastIdleTimeout` and `ageSessionPastAbsoluteLifetime` move
one session's timestamps into the past (found from the browser's refresh cookie, so the user's other sessions are left
alone), and `addFailedSignInsFromElsewhere` raises an account's count of failed sign-ins from unrecognised devices
(every test signs in from 127.0.0.1, and the per-address limit of 5 stops one address before the account limit of 10).

**Waiting.** No fixed sleeps: web-first assertions, `waitForResponse`, `waitForEvent('download')` and `expect.poll`
on the database. Payment dialogs allow 45 s for the sandbox to settle on the job tick.

**Locators.** By role, label and visible text. Since November 2026 every field's `<label>` is associated with it
(`src/shared/ui/a11y.js`) and every dialog is named by its title, so `getByLabel` and `getByRole('dialog', { name })`
work; older specs still find many fields by their `name` attribute, which is part of the form-to-API contract and not
affected by styling. CSS classes and styles are never used.

Output (HTML report, traces, screenshots, uploaded documents) goes to `node_modules/.cache/mlaz-e2e/`, which git and
ESLint already ignore (the report contains JavaScript that `npm run lint` would otherwise scan).

## What is covered

| # | Scenario | Spec |
| --- | --- | --- |
| 1 | Public application through the 4-step wizard, multipart with PDFs; reference shown, 3 documents stored, tracking email sent; required fields block the step | `01-apply` |
| 2 | Upload rules: a text file named `.pdf` refused at submission; MoF upload later from the tracking page: text file refused, PDF accepted (stage moves to MoF review) | `01-apply` |
| 3 | Tracking through the emailed link (token removed from the address bar, remembered across reload); a wrong token and another application's token get "couldn't open"; resend-link fallback | `02-track` |
| 4 | Staff sign-in: wrong password; TOTP enrolment from Settings with codes computed from the shown key (RFC 6238), wrong code at enrolment, recovery codes; sign-in with a wrong then a right code; API login without the code returns no token | `03-staff-mfa` |
| 5 | Maker-checker: officer recommends (expiry date required); the maker sees no Approve and gets 403 from the API; admin approves; stage `PAYMENT_PENDING` | `04-maker-checker` |
| 6 | Approved applicant pays by mobile money (sandbox), is accredited; welcome email's set-password link (token removed from URL, mismatch caught, single use); member signs in | `05-activation` |
| 7 | Member dues by mobile money (validity extended one year) and a declined payment (`...0000`, dues stay payable) | `06-dues` |
| 8 | Two members pay by bank transfer with proof upload (proof required); Finance confirms one (membership extended) and rejects the other (member can pay again) | `07-bank-transfer` |
| 9 | Certificate PDF downloaded from the tracking page and the portal; public verification by member number and certificate number; unknown number | `05-activation` |
| 10 | Customer loan added; credit check without consent blocked in the UI (no request) and refused by the API (400); three checks logged, the fourth hits the daily cap | `08-credit-check` |
| 11 | Member refused at the Secretariat sign-in; console addresses show the portal; own payment visible, another member's payment and receipt 404, console API 403 | `09-member-permissions` |
| 12 | Communications Officer: payments and applications menus hidden, addresses fall back to the dashboard, API 403; Finance Officer cannot approve (API 403, no buttons) | `10-staff-rbac` |
| 13 | Sign out: cookie cleared, back/reload/typed address go to sign-in, the old refresh token gets 401; session restored on reload while signed in; "sign out everywhere" ends another browser's session at its next request | `11-session` |
| 14 | Idle expiry (member): the session is aged past `SESSION_IDLE_TIMEOUT_HOURS`; a reload's refresh gets 401 and lands on sign-in, the old cookie gets 401, and another browser's session of the same user carries on. Absolute expiry (staff): aged past `SESSION_ABSOLUTE_LIFETIME_HOURS` with a fresh refresh token; the next click in the open page (valid access token) is refused, then the refresh, and the user lands on the Secretariat sign-in; old cookie 401 | `12-session-expiry` |
| 15 | Emailed sign-in code: three wrong passwords in the browser plus failures "from elsewhere" put the account under protection; the right password from a new browser gets no session but an emailed code; a wrong code is refused, the emailed one signs in; the device cookie is set, the audit log records both events, and the next sign-in from that browser needs no code | `13-sign-in-challenge` |
| 16 | Dues by card: the secure-checkout link (gateway https address, new tab, `noopener`) is checked but never opened, the payment settles, receipt downloaded, membership extended. Dues by QR code: the QR is drawn as a PNG data URL (allowed by the CSP), the payment settles. Requests to any non-local host are refused in this spec | `14-checkout` |
| 17 | Events: the Communications Officer creates a free and a paid event (required fields enforced; published at once); a member registers for the free one (confirmation email) and pays for two tickets to the paid one by mobile money; both show as registered in the portal and, with tickets, amount and payment, in the Secretariat's event dialog | `15-events` |
| 18 | Accessibility: every page of the public site (7), the member portal (7) and the console (10) has no unnamed form field, button or link, no image without alt text and no unnamed dialog (checked in the page, no extra dependency); the sign-in form works from the keyboard with a visible focus indicator; moving to a page puts focus on its heading and announces it; a dialog opened from the keyboard is named, starts at its first field and gives focus back on Escape; a failed save inside a dialog is shown with `role="alert"` | `16-accessibility` |

Every test also fails on any Content-Security-Policy violation the browser reports (see above).

## Flakiness: upload limits under parallel load

There is no upload-limit test in this suite: the browser specs upload a few small PDFs, at most one request per
worker at a time (3 workers), far below `UPLOAD_MAX_CONCURRENT` (8) and `UPLOAD_TEMP_QUOTA_MB` (400), so they cannot
interfere with each other through those limits. The upload-limit tests are the API's (`server/test/phase3.test.ts`,
"R2"), and they were timing-sensitive for two reasons:

- **A race in "limits uploads in progress".** Three 28.5 MB uploads were started, the test waited (at most 3 s) until
  all three slots were taken, then sent a fourth upload and expected 503. Nothing kept the three in progress while the
  fourth was authenticated (a database round trip): when that took longer than the remaining upload time (busy
  database or CPU), the slots were free again and the fourth was accepted. Fixed in the test: each of the three uploads
  now pauses after its first megabyte until the fourth has been answered, then carries on to the end, so every
  assertion (503 for the fourth, 201 for the three, data on disk and not in memory) is unchanged and no longer depends
  on timing. The waits for the slots to fill and for the stalled upload's temporary file were also given more time.
- **Concurrent runs share state.** Two `vitest` runs at once (two terminals, or a check script beside a manual run)
  share the `mlaz_test` database and the `./storage-test` and `./upload-tmp-test` folders: one run's reset ends the
  other's sessions (401s) and its temporary files are counted by the other's "nothing left behind" checks. Run the API
  tests one at a time per checkout. The e2e suite does not have this problem: its database, ports and folders are its own.

## Known gaps

- **Session expiry** is reached by moving timestamps in the database, not by waiting: the access token in a page that
  sat idle is not expired for real (a reload stands in for it). Real clock behaviour is covered by the API tests.
- **Sign-in protection** is triggered partly through the database: failures from other addresses cannot come from one
  browser.
- **The card gateway's hosted page** is never opened (it is an external site); the sandbox settles card and QR payments
  on its own. Declined card or QR payments, webhooks, and paid-event cancellation and refunds are not covered.
- **HTTP rate limits** are disabled by `NODE_ENV=test` (see above).
- **Recovery-code sign-in**, MoF renewals, Communications features (announcements, messages), event editing and
  cancellation, and cancelling a free registration are not covered yet.
- The CSP guard reads Chromium's console reports; violations in a page the test never opens are not seen.
- Only Chromium.
- The suite needs the Docker PostgreSQL on port 5435 (or `E2E_DB_ADMIN_URL`/`E2E_DATABASE_URL`).

## Repeating specs

The database is reset and seeded once per run, and some specs change what they find (`08-credit-check` adds a loan
and uses the member's daily credit-check cap; `13-sign-in-challenge` sends a sign-in code, capped at 5 per account per
hour). Run those once per seeded database: `--repeat-each` on them fails by
design (the second pass finds the first pass's data), not because the test is flaky. The browser runs with reduced
motion (`playwright.config.ts`), so Bootstrap modals settle their focus before a test types into them.

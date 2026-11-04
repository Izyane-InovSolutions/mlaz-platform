# MLAZ Platform: API modules

The API's twelve business modules, in `server/src/modules/`. For the layers inside a module, the rules between modules
and how they are enforced, see [architecture.md](architecture.md). This page says what each module is responsible
for, which tables it owns (only the owner writes them), what it offers other modules and what it depends on.

"Public interface" is the module's `index.ts`. Routes are listed by scope (see "Request scopes" in architecture.md).

## Dependencies between modules

Business dependencies only (a route's use of the identity session guards is left out, see architecture.md). Each line
reads "uses". The graph has no cycles; `server/test/architecture.test.ts` fails if one appears.

```
reporting       -> membership, applications, payments, events, communications, administration, identity, audit
applications    -> membership, payments, administration, documents, communications, identity (types), audit
lending         -> membership, identity (types), audit
finance         -> events, audit
events          -> membership, payments, communications, audit
membership      -> identity, payments, administration, communications, documents, audit
payments        -> administration, documents, communications, audit
administration  -> identity, audit
identity        -> communications, audit
communications  -> documents, audit
documents       -> audit
audit           -> (shared kernel only)

Ports (wired in platform/modules.ts, so the arrow points the other way):
payments.SettlementHandler        <- implemented by applications, membership (dues), events
communications.AudienceDirectory  <- implemented by membership
```

## Modules

### identity

Users, sign-in and its brute-force protection (throttles, challenge mode, recognised devices), sessions and refresh
token rotation, password links, two-factor sign-in, staff accounts, member portal users, and RBAC.

- **Owns:** `User`, `AuthSession`, `RefreshToken`, `UserToken`, `LoginThrottle`.
- **Domain:** `roles.ts` (permissions per role), `users.ts` (password policy, staff email domain, actor labels),
  `throttle-policy.ts` (limits and keys), `totp.ts` (RFC 6238, recovery codes).
- **Use cases:** `sign-in.ts`, `sessions.ts` (issue, refresh, sign out; each atomic), `passwords.ts` (invites, resets,
  changes), `mfa.ts`, `staff.ts`, `authenticate.ts` (the per-request session check), `throttling.ts`, `devices.ts`,
  `prune.ts` (nightly).
- **Infrastructure:** `jwt.ts`, `password-hasher.ts` (argon2id), `secret-box.ts` (AES-256-GCM for TOTP secrets),
  `throttle-store.ts` (atomic counters in SQL).
- **Public interface:** `inviteUser`, `sendInvite`, `emailTaken`, `setMemberUserActive`, `memberPortalUsers`,
  `pruneAuthRecords`, `can`, `ROLE_LABEL`, `STAFF_ROLES`, types `AuthUser`, `Role`.
  **http.ts:** `requireStaff(permission?)`, `requireMember`, `authenticate`, `actorOf`, `userOf`, `memberIdOf`.
- **Routes:** auth `/login`, `/login/mfa`, `/refresh`, `/logout`, `/logout-all`, `/me`, `/password/*`, `/mfa/*`;
  admin `/staff`, `/staff/:id`, `/staff/:id/resend-invite`.

### membership

The member register and the rules of standing: dues periods, accreditation and certificates, suspension and
reinstatement, MoF renewals, the nightly rules (lapse, MoF expiry, reminders), and the public directory and lender
verification.

- **Owns:** `Member`, `Certificate`, `MofRenewal`, `DuesPayment`, `ReminderLog`.
- **Domain:** `standing.ts` (good standing, dues periods, certificate serials, reminder offsets).
- **Use cases:** `accreditation.ts` (turning a paid application into a member; suspend; reinstate), `dues.ts` (apply a
  dues payment, start one, record one offline; the DUES settlement handler), `renewals.ts`, `nightly.ts`,
  `members-admin.ts` (the Secretariat's member screens), `member-portal.ts` (the member's own profile and certificate),
  `directory.ts`, `audiences.ts` (the communications AudienceDirectory), `queries.ts`.
- **Infrastructure:** `certificate-pdf.ts`.
- **Public interface:** `inGoodStanding`, `dueReminder`, `memberSummary`, `memberById`, `goodStandingWhere`, `duesDueWhere`,
  `accreditApplication`, `duesSettlement`, `memberAudiences`, `portalAlerts`, `applicantCertificate`, nightly rules.
- **Routes:** admin `/members*`, `/renewals*`, `/certificates`; portal `/profile`, `/activity`, `/certificate.pdf`,
  `/mof-renewals`, `/dues`, `/dues/payments`; public `/stats`, `/verify`, `/directory`.

### applications

The applicant's journey on the public website (with a tracking token, no account), the Secretariat's review queue and
automated checks, and the maker/checker decision: an officer recommends, a different person approves.

- **Owns:** `Application`.
- **Domain:** `journey.ts` (stages, display stage, maker/checker, duplicate matching, required documents, flags).
- **Use cases:** `applicant.ts` (submit, track, MoF upload, pay, proof of payment, resend link), `review.ts` (list,
  checks, detail, recommend, approve, decline, return, reject, offline payment; the APPLICATION settlement handler),
  `tracking.ts` (tracking tokens).
- **Public interface:** `submit`, `submitSchema`, `startPayment`, `uploadMof`, `list`, `detail`,
  `checks`, `recommend`, `approve`, `applicationSettlement`, `OPEN_STAGES`, `displayStage`, `trackingToken`.
- **Routes:** public `/applications`, `/applications/:ref*`; admin `/applications`, `/applications/:ref*`.

### payments

Creating payments, sending them to the gateway, applying an outcome exactly once (row lock, final-state check, late
success honoured), bank transfers with proof of payment, offline payments, reconciliation, expiry and webhooks.

- **Owns:** `Payment`, `PaymentLine`.
- **Domain:** `payment-rules.ts` (methods, reasons, late-success rule, line pricing, amount tolerance).
- **Use cases:** `create-payment.ts` (create, lock per target, guard against a second payment in flight),
  `initiate-payment.ts`, `settle-payment.ts`, `bank-transfers.ts`, `reconciliation.ts` (reconcile, expire, webhooks),
  `queries.ts` (the one payment view), `checkout.ts` (the "pay now" body), `settlement-handlers.ts` (the port).
- **Infrastructure:** `gateways.ts` (the PaymentProvider interface and the sandbox), `receipt-pdf.ts`.
- **Public interface:** `createPayment`, `guardPending`, `lockPayments`, `initiate`, `recordOffline`, `attachProof`,
  `settle`, `reconcilePending`, `expireStale`, `paymentView`, `paymentsFor`, `latestPayment`, `ownedPayment`,
  `receipt`, `linkToMember`, `cancelForEvent`, `registerSettlementHandler`, `checkoutSchema`, `offlineSchema`.
- **Routes:** admin `/payments*` (list, view, receipt, confirm, reject, reconcile); portal `/payments*`; webhooks
  `/payments/:provider`.
- Payments knows nothing of what a payment pays for: that is the SettlementHandler port.

### events

AGMs, trainings and webinars: the Secretariat creates, edits and cancels them (refunds flagged), members register
(places held while a ticket payment is pending), and the EVENT settlement handler confirms or releases those places.

- **Owns:** `Event`, `Registration`.
- **Use cases:** `events.ts` (staff side, upcoming events), `registrations.ts` (member side, the settlement handler).
- **Public interface:** `upcomingEvents`, `eventExists`, `MAX_TICKETS`, `eventSettlement`.
- **Routes:** admin `/events*`; portal `/events*`; public `/events`.

### finance

The association's own expenses (soft-deleted, so the audit trail keeps them). Income is in payments; the finance
summary is a report. **Owns:** `Expense`. **Public interface:** none (nothing depends on it). **Routes:** admin `/expenses*`.

### lending

Members' own loan books and credit-bureau checks. A check needs the borrower's consent and a purpose, is capped per
member per day under a lock, and is the one network call made inside a transaction (documented in architecture.md).

- **Owns:** `Loan`, `CreditCheck`.
- **Domain:** `credit-scores.ts`. **Infrastructure:** `bureau.ts` (the CreditBureau interface; simulated driver).
- **Public interface:** none (nothing depends on it). **Routes:** portal `/loans*`, `/credit-checks`.

### communications

The transactional outbox (written in the same transaction as the change it reports, delivered by the job scheduler),
announcements, broadcasts to audiences, the resource library, and message delivery operations.

- **Owns:** `Notification`, `Announcement`, `Broadcast`, `Resource`.
- **Use cases:** `outbox.ts` (`notify`, `processOutbox`, retries), `engagement.ts` (announcements, broadcasts,
  resources), `messages.ts` (what every message shares), `audiences.ts` (the AudienceDirectory port).
- **Infrastructure:** `messaging.ts` (SMTP with bounded timeouts, log drivers).
- **Public interface:** `notify`, `processOutbox`, `listAnnouncements`, `Message`, `SIGNOFF`, `memberPortalUrl`,
  `expiresIn`, `provideAudienceDirectory`. Each module writes its own message templates next to its use cases.
- **Routes:** admin `/announcements*`, `/broadcasts*`, `/resources*`, `/notifications*`; portal `/announcements`,
  `/resources*`; public `/announcements`.

### documents

Uploaded files: streaming uploads to private temporary files with quotas and timeouts, content sniffing, moving them
into storage (local or S3) and recording them, and sending them back as sandboxed attachments.

- **Owns:** `Document`.
- **Use cases:** `files.ts` (store, commit or discard), `records.ts` (record against an owner, supersede, reassign,
  staff and member downloads). **Infrastructure:** `storage.ts` (local and S3 drivers with bounded retries).
- **Public interface:** `storeFile`, `storeFiles`, `commitFiles`, `requireFile`, `recordDocument(s)`,
  `supersedeMofDocuments`, `assignApplicationDocuments`, `currentDocumentKinds`, types `UploadedFile`, `StoredFile`.
  **http.ts:** `readMultipart`, `sendDocument`, and the platform's upload hooks.
- **Routes:** admin `/documents/:id` (viewing is audited); portal `/documents/:id` (own documents only).

### administration

Association-wide settings (joining fee, renewal window, bank account) and membership tiers.

- **Owns:** `Tier`, `Setting` (apart from the scheduler's nightly claim row).
- **Public interface:** `getSetting`, `setSetting`, `fees`, `tierDues`, `activeTiers`, `findTier`, `SETTING_DEFAULTS`.
- **Routes:** admin `/settings`, `/settings/tiers/:name`, `/settings/fees`, `/settings/bank-account`.

### audit

The audit trail (every change, who and when) and member timelines. Both are append-only and written in the
transaction of the change they describe.

- **Owns:** `AuditLog`, `MemberActivity`. **Public interface:** `audit`, `activity`, `trailFor`, `timelineFor`.
- **Routes:** admin `/audit`.

### reporting

Read models over the other modules: the staff dashboard and sidebar counts, the finance summary, console search, the
Secretariat's reports and CSV exports (audited), the member portal's front page, and the website's reference data.
It writes nothing except audit entries. **Public interface:** none (nothing depends on it).

- **Routes:** admin `/dashboard`, `/nav-counts`, `/search`, `/payments/summary`, `/reports`, `/reports/:key`; portal
  `/overview`; public `/config`.

## Adding to a module

- A new rule with no I/O goes in `domain/` with a unit test in `server/test/domain.test.ts`.
- A new operation is a use case in `application/`: it takes plain values (and an `Actor` if it changes anything), runs
  its writes and their audit entry in one transaction, and queues messages with `notify` in that transaction.
- A new endpoint goes in `presentation/`: validate with zod, call the use case, shape the reply. No database access.
- Another module needs it: export it from `index.ts`. If that would create a cycle, the dependency points the wrong way;
  define a port in the lower module instead (see "Ports" in architecture.md).
- A new table: add it to the ownership map in `server/test/architecture.test.ts`.

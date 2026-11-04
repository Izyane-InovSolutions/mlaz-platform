# MLAZ Platform: Architecture decisions

The main choices behind the structure in [architecture.md](architecture.md), with what was considered and why. Newest
last. Each entry stays as written when it was decided; a later decision that changes one says so.

## 1. A modular monolith, not services (October 2026, confirmed November 2026)

**Decision.** One API process and one database, divided into business modules with enforced boundaries.

**Why.** The load is small, the team is small, and the operations that matter most (settling a payment and accrediting
a member, recording a change and its audit entry and its email) must commit together. Across services that needs
sagas or two-phase commit; inside one database it is a transaction. The boundaries are enforced so a module could be
split out later if there were ever a reason.

## 2. Modules by business area, with four layers each (November 2026)

**Decision.** Twelve modules (identity, membership, applications, payments, finance, lending, events, communications,
documents, reporting, administration, audit), each with `domain`, `application`, `infrastructure` and `presentation`
layers, a public `index.ts`, and a `module.ts` that registers its routes. A module has only the layers it needs.

**Why.** The earlier layout (`routes -> services -> lib`) was layered by technical role. A change to one business area
touched files across every layer folder, and services grew into large files with unrelated responsibilities
(`accounts.ts`: about 550 lines and six concerns). Grouping by business area keeps a change in one place, and the
layers inside each module keep rules testable without HTTP or a database.

## 3. Prisma is the data access layer; no repository per table (November 2026)

**Decision.** Use cases use the Prisma transaction client directly. Hand-written SQL that carries a concurrency
guarantee (throttle counters, leases, row locks, outbox claims) is isolated in named functions. Adapters to other
systems (gateway, bureau, mail, storage) sit behind interfaces in `infrastructure/`.

**Considered.** A repository interface plus a Prisma implementation for each of the 30 tables.

**Why not.** It would roughly double the data access code without making anything more testable: the tests run against
a real PostgreSQL on purpose, because the correctness that matters here (locks, `SKIP LOCKED`, unique constraints,
atomic counters) only exists in the database. Prisma's typed client already isolates SQL. What the layering does
enforce is that domain rules never see Prisma, routes never see the database, and every table has one writer module.

## 4. One writer per table; reads may cross modules (November 2026)

**Decision.** Each table is owned by one module, which alone creates, updates or deletes its rows. Other modules call
the owner's public functions. Reads across modules are allowed, and the reporting module reads everything.

**Why.** Ownership of writes is what keeps business rules in one place (a document is recorded one way, a payment is
cancelled one way). Forbidding cross-module reads would force a query API for every screen that joins two areas, for
no gain in correctness. The rule is checked by the architecture test.

## 5. Ports for the two dependencies that pointed upwards (November 2026)

**Decision.** Payment settlement calls a `SettlementHandler` registered for the payment's purpose (applications,
membership dues, events), and broadcasts get recipients from an `AudienceDirectory` provided by membership. Both are
wired once, in `platform/modules.ts`.

**Why.** Settlement imported membership (accreditation, dues) and contained the events module's registration logic,
so payments, the lowest-level financial module, knew every module that sells something. Broadcast audiences needed
member data while membership needed the outbox, a module cycle. Turning those two dependencies around removed both,
without changing a single transaction boundary: handlers run inside the settlement transaction, with the row locked.
A purpose without a handler throws, so a wiring mistake cannot mark money received without applying it.

## 6. Explicit injection only where it decouples (November 2026)

**Decision.** Cross-module behaviour is injected (the two ports above). Adapters (gateway, bureau, mailer, storage) are
module-level instances chosen from configuration in their own `infrastructure/` file. There is no DI container.

**Why.** The two ports are where injection changes the dependency graph. Injecting every adapter through constructors
would thread them through every use case for no gain: there is one implementation of each per environment, and the
tests exercise the real ones (the sandbox gateway, the log mailer, local storage) or replace them with `vi.spyOn`.

## 7. Routes are mounted by scope (November 2026)

**Decision.** A module hands the platform its routes per scope (`auth`, `public`, `portal`, `admin`, `webhooks`); the
platform owns each scope's prefix and guard.

**Why.** Before, each route file set up its own guard (`portal.ts` added `requireMember` itself). Now a module cannot
mount a member route without the member guard, or a console route outside the staff guard. URLs did not change.

## 8. Message templates live with the module that sends them (November 2026)

**Decision.** Each module keeps its email and SMS templates in `application/messages.ts`; communications keeps only the
outbox and what every message shares (sign-off, portal link).

**Why.** One 100-line template object in the notification service changed with every module's wording, and forced the
outbox to import every domain's view of a member or payment. A template belongs next to the use case that sends it.

## 9. Session writes in one transaction (November 2026)

**Decision.** Starting a session, refreshing it, signing out, "sign out everywhere" and changing the password each
commit in one transaction. A refresh claims the old token and writes its successor together.

**Why.** Open item D4 of the October review: a crash between the separate writes could leave a session with its old
token retired and no new one (the user is signed out) or a password changed with old sessions still alive. The claim
keeps its theft detection: a parallel refresh waits for the row, then finds it already claimed and ends every session.

## 10. Authenticator-code attempts counted per step, device and session; replay prevention per user (November 2026)

**Decision.** The last used TOTP step stays per user. Failed attempts are counted per sign-in step (the mfa token,
which is now single-use), per account from unrecognised devices, per recognised device, and per session for codes that
confirm a sensitive change.

**Why.** Open item D7: one per-user counter let anyone with the password block the owner's second step for up to an
hour, and guessing inside one session blocked the owner's sign-in. Replay must stay per user (a code belongs to the
user's secret, so a code used anywhere is refused everywhere). A per-account ceiling must also stay, because a
password holder can start new sign-in steps at will; it now applies only to unrecognised devices, as the password
throttle already did. Recorded in `server/test/mfa-attempts.test.ts`.

## 11. Leaf modules export nothing (November 2026)

**Decision.** A module's `index.ts` exports only names used outside it (architecture rule); finance, lending and
reporting, which nothing depends on, export nothing.

**Why.** An unused export is an unreviewed way in. The rule keeps each interface the size its callers need.

## 12. One process logger; inside a request, the request's own (November 2026)

**Decision.** `shared/log.ts` creates the only logger. Fastify uses it for the request log, and modules write through
`log()`, which returns the current request's logger when called inside one (an AsyncLocalStorage set before the
handler runs) and the process logger otherwise. Operational events carry an `event` field.

**Considered.** Passing a logger into every use case; or leaving module code on `console.error`.

**Why.** `console.error` lines were not JSON, had no request id and bypassed the redaction list, so they could not be
alerted on or traced to a request. Threading a logger through every use case would change dozens of signatures for no
other gain. The AsyncLocalStorage is set once, in one hook, after body parsing (whose socket events would otherwise
lose it).

## 13. A stand-in for an external service is never reported or treated as the real one (November 2026)

**Decision.** Each integration has a state (`live`, `simulated`, `off`) decided on the server (`shared/integrations.ts`)
and shown in Settings and `/health/status`. Production refuses `SMS_DRIVER=log` and, unless the site is a declared
staging site, `BUREAU_DRIVER=simulated`. With `none`, the feature says it is unavailable (no SMS is queued; credit
checks answer 503) instead of pretending. Simulated credit reports are labelled as such to the member.

**Why.** The log SMS driver marked messages sent that were never delivered, and wrote phone numbers into the log; the
simulated bureau would have shown lenders invented credit reports on a live site. Both looked like working features.

## 14. Node 24 everywhere (November 2026)

**Decision.** The API and migration images (`server/Dockerfile`) and the backup runner (`ops/backup/Dockerfile`) use
Node 24, the version in `.nvmrc` that CI and development already used. Previously the images used Node 22.

**Why.** Tests ran on 24 while production would have run on 22, so a difference between them would only have appeared
in production. Node 24 is the Active LTS line, and every dependency supports it (the strictest `engines` range is
`^22.20 || ^24.12 || >=25`). No host has been chosen yet, so the image is the runtime and nothing outside the
repository constrains the choice. Verified on 4 November 2026: all three images build, the migrate image applies every
migration, and the API image serves its health probes and refuses unsafe production settings.

## 15. `staging` and `main` are recorded as merged, not merged file by file (November 2026)

**Decision.** `staging` and `main` are reconciled with `preview` by `git merge -s ours` on side branches
(`release/staging-sync`, `release/main-sync`). Each merge commit keeps `preview`'s tree and makes the other branch an
ancestor, so `staging` and `main` can later be fast-forwarded by pull request. What those branches had that was still
needed (the MLAZ logo and the `.env.*.local` ignore rule) was first carried into `preview` as an ordinary commit
(`222d7b5`). Details per file: [OPERATIONS.md](OPERATIONS.md), "Environments and branches".

**Why.** Every conflicting file was the logo (now on `preview`) or the October prototype's Supabase persistence layer,
which gave the browser direct access to every record and is replaced by the API. A plain merge would have auto-merged
parts of it back in (the Supabase dependency, a second copy of the logo links). Force-pushing `preview` over the
branches would have thrown away their history. With `-s ours`, nothing is rewritten, every old commit stays reachable,
and the old files can still be recovered from history if anything turns out to be missing.

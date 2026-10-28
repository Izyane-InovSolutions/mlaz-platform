# Quality and security checks

Every push is checked twice: by a Git **pre-push hook** on your machine, and by **CI** (GitHub Actions) on the
server. Both run the same checks. The hook gives you the answer before anyone else sees the code; CI is the gate that
cannot be skipped.

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22.13 or newer (CI uses 24, see `.nvmrc`) | ESLint 10 and the API need it |
| npm | 10 or newer (ships with Node) | Lockfiles are version 3 |
| Git | 2.31 or newer | Hooks, `git diff --check` |
| Docker | any recent | The API tests need PostgreSQL (`server/docker-compose.yml`) |

There are two npm projects: the UI at the root and the API in `server/`. Each has its own `package-lock.json`. All
the check commands run from the **root**.

## One-time setup

```bash
npm install                       # UI dependencies, check tools, and installs the Git hooks (Husky)
cd server && npm install          # API dependencies
cp .env.example .env              # then set JWT_SECRET, DATA_ENCRYPTION_KEY and WEBHOOK_SECRET (see the comments)
npm run db:up                     # PostgreSQL on localhost:5435, with the mlaz_test database for the tests
cd ..
```

Check the hook is installed: `git config core.hooksPath` should print `.husky/_`. If it does not, run `npm run prepare`.

The first secret scan downloads Gitleaks 8.30.1 from GitHub (about 7 MB) into `node_modules/.cache/gitleaks`. The
download is checked against a pinned SHA-256 before use. Where GitHub downloads are blocked, install Gitleaks yourself
and point `GITLEAKS_BIN` at it.

## Commands

| Command | Checks | Needs |
| --- | --- | --- |
| `npm run lint` | ESLint on the UI, scripts, tests and API: likely bugs, string-built code (`eval`, `new Function`), unsafe regular expressions, file access with computed paths in API routes and services. Fails on any warning. | — |
| `npm run lint:fix` | Fixes what ESLint can fix automatically. Review the result. | — |
| `npm run format:check` | Every tracked file: UTF-8 (and no double-encoded text such as a mangled middle dot), LF line endings in the repository, no tab indentation, no trailing whitespace, exactly one final newline (`.editorconfig`). Read-only. | — |
| `npm run format` | Fixes trailing whitespace and final newlines. | — |
| `npm run typecheck` | `tsc --noEmit` on the API (strict mode). The UI is plain JavaScript and is covered by ESLint. | — |
| `npm test` | UI tests (`test/`): the Content-Security-Policy and the absence of inline script, in the source and, after `npm run build`, in the built bundle. | — |
| `npm run test:server` | All API tests (`server/test/`, about 145 tests, ~3 min) against a real PostgreSQL, including the architecture test (`architecture.test.ts`: which layer may import which). | Test database |
| `npm run test:security` | Only the security regression tests (see below). Handy while working on security fixes. | Test database |
| `npm run build` | Production build of the UI (Vite) into `dist/`. | — |
| `npm run build:server` | Compiles the API into `server/dist/`. | — |
| `npm run check:lockfile` | Both `package-lock.json` files match their `package.json`, so `npm ci` installs what the manifest says. | — |
| `npm run check:whitespace` | `git diff --check` and `git diff --cached --check`: whitespace errors and leftover conflict markers in your unstaged and staged changes. | — |
| `npm run security:deps` | `npm audit` on both lockfiles, applying `audit-policy.json`. | npm registry |
| `npm run security:secrets` | Gitleaks on the whole Git history plus your staged and unstaged changes. Values are always redacted in the output. | GitHub (first run only) |
| `npm run check` | **Fast suite**: whitespace, format, lint, types, secrets, UI tests. No database or network. ~30 s. | — |
| `npm run check:full` | **Full suite**, the same as CI: everything above, including the dependency audit, both builds and all tests. ~2–3 min. | Test database, npm registry |

`npm run check` and `npm run check:full` stop at the first failing step and name it with a hint on how to fix it.
Add `-- --keep-going` to run every step and get a list of all failures:
`npm run check:full -- --keep-going`.

Each test runs once per suite. `test:security` is a subset of `test` + `test:server`, so the suites do not repeat it.

### Security regression tests

These fail if a previously fixed vulnerability comes back:

| Area | Where |
| --- | --- |
| Distributed sign-in attacks and lock-out (attackers cannot lock the real user out; per-address and per-account limits; counters shared across instances; per-account caps on reset emails and sign-in codes) | `server/test/phase3.test.ts` "R1", `server/test/remediation.test.ts` "L2", `server/test/security.test.ts` "brute-force protection" |
| Uploads: streamed to disk not memory, size limits (413), content-type sniffing, path tricks, dropped and stalled uploads, concurrency, clean-up | `server/test/phase3.test.ts` "R2", `server/test/remediation.test.ts` "L5, L7" |
| Sessions: absolute lifetime, idle timeout, refresh-token rotation, reuse detection, expiry of old tokens | `server/test/phase3.test.ts` "R3", `server/test/security.test.ts` "sessions and cookies" |
| Content-Security-Policy on the API and the UI, and that legitimate UI actions still work under it | `server/test/phase3.test.ts` "R4", `test/csp.test.mjs` |
| Payment gateway unreachable or slow at initiation (late success still recorded, no lost payments) | `server/test/payments.test.ts` "gateway could not be reached", "times out a slow gateway" |
| Dependency direction between layers (lib, providers, services, routes, jobs) | `server/test/architecture.test.ts` |
| Health probes, request ids, no internals in 500 responses, job runner isolation and shutdown | `server/test/runtime.test.ts` |
| Authorization, injection (control characters, markup in names, `__proto__`), sensitive data exposure, two-factor sign-in | `server/test/security.test.ts`, `server/test/remediation.test.ts` |

The tests use their own database (`mlaz_test`), simulated payment, SMS and credit-bureau providers, and log email
instead of sending it. They never need production credentials.

## Before you push

```bash
git status                        # anything unexpected? (.env files, logs, dist/, storage/, unrelated edits)
git diff --cached                 # read exactly what you are about to commit
npm run check:whitespace          # whitespace errors in unstaged and staged changes
npm run check                     # fast checks while you work
npm run check:full                # optional: the pre-push hook runs this anyway
```

Stage files by name (`git add path/to/file`) or interactively (`git add -p`) rather than `git add .`, and never commit:

- `.env` or `server/.env` (only the `.env.example` files belong in Git);
- credentials, private keys, tokens, database dumps, or files from `server/storage*`;
- logs, `dist/`, `server/dist/`, `coverage/`, `node_modules/`;
- changes unrelated to the commit.

The `.gitignore` files cover the usual cases, but `git add -f` and new file names get past them. The secret scan is a
safety net, not a substitute for reading the diff.

## The pre-push hook

`git push` runs `.husky/pre-push`, which runs `node scripts/check.mjs pre-push`. That is the full suite, except that the
secret scan and the whitespace check cover **exactly the commits being pushed** (Git passes them to the hook). Any failure
stops the push, and the summary names the failed step:

```
━━━ summary (pre-push, 142s) ━━━
✔ whitespace         0.1s
✔ format:check       0.4s
✖ lint               9.8s
- typecheck          not run
...
FAILED: lint. The push was stopped.
```

Notes:

- Lint, tests and builds run on your **working tree**, which may differ from the commits you push. If you have
  uncommitted changes, the hook warns you. For an exact result, commit or `git stash` them first.
- The API tests need the test database. If it is not running the hook fails with a hint: `cd server && npm run db:up`.
- The dependency audit needs the npm registry. You need the network to push anyway.
- The hook uses only the project's own dependencies (`node_modules`), never global tools. It works in Git Bash on
  Windows, and on macOS and Linux.

### Emergency bypass

`git push --no-verify` skips the hook. Use it only when a check is wrong and blocking urgent work, such as a broken
external service during an incident. Say so in the pull request. CI still runs every check and will block the merge
if something really is wrong. Do not use it to push a secret or a failing test "to fix later".

## CI

`.github/workflows/ci.yml` runs on every pull request, on pushes to `main`, on demand, and every Monday (to catch
advisories published since the last change). It has three jobs:

| Job | Runs |
| --- | --- |
| Lint, format, types, UI tests and builds | `check:lockfile`, `npm ci` in both projects, `format:check`, `lint`, `typecheck`, `build`, `build:server`, `test` |
| API tests (incl. security regression tests) | All API tests against a PostgreSQL 17 service container. Signing keys are random for each run; no repository secrets are used |
| Dependency audit, secret scan and diff check | `security:deps`, Gitleaks over the full history, `git diff --check` between the pull request's base and head |

The workflow only has `contents: read` permission. It runs on `pull_request`, not `pull_request_target`, so pull
requests from forks get no secrets and no write access. Actions are pinned to commit SHAs. It never deploys: Vercel
deploys the UI separately.

### Making CI block merges (manual, once)

CI reports failures, but GitHub only **blocks merging** once branch protection requires the checks. This repository
setting is not in the code, so it has not been verified. A repository admin must set it:

1. Open the repository on GitHub, then **Settings → Branches** (or **Settings → Rules → Rulesets**).
2. Add a rule (or ruleset) for the branch `main`.
3. Turn on **Require a pull request before merging**.
4. Turn on **Require status checks to pass**. Then search for and add the three checks (they appear after the
   workflow has run once):
   - `Lint, format, types, UI tests and builds`
   - `API tests (incl. security regression tests)`
   - `Dependency audit, secret scan and diff check`
5. Turn on **Require branches to be up to date before merging**.
6. Turn on **Do not allow bypassing the above settings** (or leave admins out of the bypass list).
7. Save.

## When a check fails

| Failed step | What to do |
| --- | --- |
| `whitespace` | Remove the trailing whitespace or leftover `<<<<<<<` markers at the reported lines, then amend or add a commit. |
| `format:check` | `npm run format`, review the diff, commit. Tabs and CRLF committed to the repository must be fixed by hand. |
| `lint` | Fix the reported problem. If a finding is genuinely a false positive, disable it on that line only, with a reason: `// eslint-disable-next-line rule-name -- why this is safe`. Unused or reasonless disables are themselves errors. Do not switch rules off in `eslint.config.js` to make a failure go away. |
| `typecheck` | Fix the TypeScript error (`npm run typecheck` shows it). |
| `check:lockfile` | `npm install` in the folder named, and commit the updated `package-lock.json`. |
| `test`, `test:server` | Run the suite on its own to see the failure, for example `cd server && npx vitest run test/phase3.test.ts`. Is the database up? |
| `build`, `build:server` | Run the build on its own and fix the error. |
| `security:deps` | See the next section. |
| `security:secrets` | See "A secret was found" below. **Do not push.** |

## A dependency has a vulnerability

The policy is in `audit-policy.json`:

- **Blocking threshold: `high`.** Advisories rated `high` or `critical`, in either project and in dependencies or
  devDependencies, block pushes and CI. `moderate` and below are listed but do not block. Review them when you
  update dependencies.
- Change the threshold for everyone in `audit-policy.json` (by pull request). To try a stricter level locally, use
  `AUDIT_LEVEL=moderate npm run security:deps` (PowerShell: `$env:AUDIT_LEVEL='moderate'; npm run security:deps`).
- The check never changes dependencies. Do not run `npm audit fix --force`, and do not upgrade everything at once.

To fix a finding:

1. Read the advisory (the link is in the output). Is the vulnerable code reachable in this project?
2. Upgrade the package that brings it in: `npm install <package>@<fixed version>` in the right folder. Review the
   changelog for major versions. For a transitive dependency, upgrade its parent, or add an `overrides` entry in
   `package.json` when the parent has no fixed release yet.
3. Run `npm run check:full` and commit `package.json` and `package-lock.json` together.

If there is no fix yet, or the vulnerable code cannot be reached here, record an **exception**. It needs a reviewed
pull request, and someone other than the author must approve it:

```json
{
  "threshold": "high",
  "exceptions": [
    {
      "id": "GHSA-xxxx-xxxx-xxxx",
      "package": "some-package",
      "project": "server",
      "reason": "Only reachable through X, which we do not use; no fixed release yet. Tracked in #123.",
      "approvedBy": "Name of the approver",
      "expires": "2027-01-15"
    }
  ]
}
```

An exception covers one advisory in one package, never "all audit failures". It stops applying on its `expires` date,
which should be no more than 90 days ahead. The check also warns about exceptions that no longer match anything, so
they can be removed.

## A secret was found

Gitleaks reports the file, line, commit and rule, with the value redacted.

**If it is a real credential, treat it as compromised as soon as it has left your machine.** Removing it from Git does
not undo a push.

1. **Do not push** (or stop pushing). If it was already pushed, tell the team lead now.
2. **Rotate it first**: revoke the key or token and issue a new one at its provider. For this project's own secrets,
   generate new values: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Changing
   `JWT_SECRET` signs everyone out. Changing `DATA_ENCRYPTION_KEY` needs a re-encryption plan for stored two-factor
   secrets, so ask before rotating it.
3. Move the value into `.env` (ignored by Git), or into the hosting provider's environment settings.
4. **Not yet pushed:** remove it from your commits (`git commit --amend`, or `git rebase -i` for older commits), then
   run `npm run security:secrets` again.
5. **Already pushed:** rewriting history is a team decision, because everyone must re-clone afterwards. Coordinate
   first, then use [`git filter-repo`](https://github.com/newren/git-filter-repo)
   (`git filter-repo --replace-text replacements.txt`), force-push, and ask GitHub Support to purge cached views and
   pull request refs. The rotation in step 2 is what actually protects you; the rewrite only tidies up.
6. Check the provider's logs for use of the leaked credential while it was exposed.

**If it is a false positive** (a test fixture, an example value, a hash):

- For one line: add `gitleaks:allow` in a comment on that line, and explain it in the pull request.
- For a recurring, clearly harmless pattern or a generated file: add a narrow allowlist entry to `.gitleaks.toml` with
  a `description`. Never exclude whole source folders.

## Which checks need what

| Check | Runs locally | Needs |
| --- | --- | --- |
| format, lint, typecheck, lockfile, whitespace, UI tests, builds | Yes, offline | — |
| API tests and security regression tests | Yes | Docker and the test database (`cd server && npm run db:up`) and `server/.env` |
| Dependency audit | Yes | Access to registry.npmjs.org |
| Secret scan | Yes | GitHub access on first run (or `GITLEAKS_BIN`) |
| Branch protection (merge blocking) | No, GitHub only | A repository admin (see "CI") |

Every check can run locally. Only enforcement, meaning blocking the merge, is CI's job alone.

## Decisions and known gaps

- **No automatic code formatter (yet).** The code uses long, dense lines. Prettier would rewrite about 4,400 of
  roughly 9,300 lines. `format:check` therefore enforces the whitespace and encoding conventions the code already
  follows. To adopt Prettier later, do it in one dedicated commit: add Prettier, run it on everything, list that commit
  in `.git-blame-ignore-revs`, and switch `format`/`format:check` to `prettier --write .`/`prettier --check .`.
- **HTML sinks in the UI are not linted.** The UI builds HTML from template strings and escapes data with `esc()`
  (`src/ui.js`). `eslint-plugin-no-unsanitized` flags about 30 `innerHTML` assignments, because it cannot tell
  `esc()`-built markup from raw data. The strict CSP (no inline or injected script, tested) limits what an injection
  could do. A worthwhile follow-up is an `html` tagged template that escapes by default, after which the rule can be
  turned on.
- **Static analysis** is ESLint with `eslint-plugin-security`. A separate SAST scanner (such as Semgrep) was not
  added. It would overlap with these rules and need a Python toolchain or a hosted account.

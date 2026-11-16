# MLAZ Platform: Frontend architecture

The UI is one static site built with Vite: vanilla JavaScript modules, Bootstrap 5 and SCSS, with no framework. It has
three areas: the public website, the member portal and the Secretariat console. All data comes from the API in
`server/` (see [architecture.md](architecture.md)). The browser stores no business data.

This document covers how `src/` is organised, the rules that keep it organised, and how to add to it.

## Layers

```
src/
  main.js        Entry point (index.html loads /src/main.js): styles, Bootstrap, then start the router.
  app/           router.js: hash routing, loading and error views, session check for #/app/*.
                 shell.js: the console and portal frame (sidebar, top bar, console search, sign out).
  features/      Everything a user can see or do, one folder per feature (below).
  shared/ui/     Business-independent building blocks: formatting, icon, cards, tables, pager, pills, modals,
                 toasts, form reading and input masks, printing. Import them all from shared/ui/index.js.
  core/          No markup:
    html.js            esc(): HTML escaping.
    events.js          The delegated event dispatcher: expose(), on(), EL, invoke().
    navigation.js      nav(), rerender(), after(): routing glue.
    api/client.js      The only module that calls fetch(): api(), pub(), download(), ApiError.
    auth/              session-store.js (display details, in-memory access token), session.js (sign in and out),
                       permissions.js (can()).
    reference-data.js  publicConfig() (tiers, fees, provinces, payment methods) and applicant tracking tokens.
  styles/        styles.scss (Bootstrap plus the MLAZ theme).
```

Dependencies only point downward: `main.js` -> `app/` -> `features/` -> `shared/ui` -> `core/`.

| Layer | May import | Why |
| --- | --- | --- |
| `core/` | other `core/` modules and packages | It sits at the bottom, so anything can use it without creating a cycle |
| `shared/ui` | `shared/`, `core/html`, `core/events` and `core/navigation`, Bootstrap | Generic UI must not know about members, payments, sessions or the API. Domain-aware pieces go in `features/common` |
| `features/` | `core/`, `shared/`, other features through their `index.js` only | Features stay independent and can be changed without reading each other's internals |
| `app/` | everything below, features through their `index.js` only | It composes the areas |

### Features

| Folder | What it is |
| --- | --- |
| `features/common/` | Domain UI used by several areas: status badges, the online checkout, `getFile()` downloads, event-type and activity labels |
| `features/account/` | Account security shared by the console and the portal: two-factor enrolment, recovery codes, password change, sign out everywhere, the secure-account page |
| `features/public/<page>/` | `layout`, `home`, `apply`, `track`, `sign-in`, `set-password`, `verify`, `directory`; `shared/` holds helpers only public pages use |
| `features/member/<page>/` | `overview`, `certificates`, `dues`, `events`, `customers`, `announcements`, `profile`; `shared/` holds the `portal()` API wrapper, the current member (`ME`) and the bank-transfer and checkout helpers used by dues and events |
| `features/admin/<page>/` | `dashboard`, `members`, `applications`, `certificates`, `payments`, `communications`, `events`, `reports`, `directory`, `settings`, `search`; `shared/` holds the `adm()` API wrapper, the document viewer, payment rows, audit trails and search boxes |
| `features/<area>/index.js` | The area's page registry: `PUBLIC`, `MEMBER_PAGES` and `MEMBER_NAV`, `ADMIN_PAGES` and `ADMIN_NAV` |

Each feature owns its page rendering, its API calls (through its area's `adm()` or `portal()` wrapper, or `pub()`), its
validation and its event handlers. Its `index.js` is its public interface. Page state, such as the application
wizard's `W`, the open application `CUR_APP` or a list's filter and page, is a module-level variable in the page that
uses it.

The feature import rule, exactly as the test checks it: a file may import

- anything in its own feature folder;
- its own area's `shared/` folder (`features/admin/members/*` may use `features/admin/shared/*`);
- another feature only through that feature's `index.js`.

## How it works

### Routing

`app/router.js` reads `location.hash`:

- `#/app/<page>/<id>` is the console or the portal, depending on the session's role.
- Anything else is a public page (`#/apply`, `#/track/APP-2045?t=…` and so on).

A page is a function `(param, query) => html | Promise<html>`. While a promise is pending the router shows a spinner,
and if the user has already moved on it drops the result. Console pages are only offered when `can(permission)` is
true: `ADMIN_NAV` lists each page's permission. The server enforces the same permissions anyway.

After the markup is in place, functions queued with `after()` run. A page uses this to fill a wizard or start polling.

### Events

The Content-Security-Policy (`vercel.json`) forbids inline script, so there are no `onclick="…"` attributes. Markup
names a registered handler and its arguments instead:

```js
`<button ${on('click', 'viewDoc', id, title)}>`   // -> viewDoc(id, title)
expose({ viewDoc });                              // in the module that owns it
```

- One listener per event type (`click`, `submit`, `input`, `change`) on the document finds the nearest `data-on-*`
  element and calls the registered function.
- Arguments are JSON data, parsed with `JSON.parse` and never evaluated.
- `EL` passes the element itself (a button to mark busy, a form to read).
- The registry is `Object.create(null)` and is never published on `window`.
- Handler names are global, so they must be unique across the app.

### Markup and escaping

Pages build HTML strings. Every value that did not come from this source code goes through `esc()` before it reaches
`innerHTML` or an attribute. The `shared/ui` helpers escape what they render themselves (toast text, modal error
messages). Callers escape the titles and text they pass in. Numbers from the API are passed through `Number()`.

URLs have a second rule. Every URL put in an `href` or `src`, or opened, goes through `safeUrl()` from `core/html.js`
first, and then `esc()`: `href="${esc(safeUrl(url))}"`. It returns `''` for anything that isn't an allowed kind:

| Kind | Allows | Used for |
| --- | --- | --- |
| `https` | absolute `https:` URLs | a payment gateway's `checkoutUrl`, which is only ever passed `'https'` |
| `self` | `#/routes`, `/paths` and this page's own origin | console links, `printDoc` stylesheets |
| `blob` | object URLs this page created (`blob:<origin>/…`) | downloads and document previews |
| `png` | base64 `data:image/png` | QR codes generated in the browser |

`javascript:`, other `data:` types, `http:`, `//host` and `/\host` never pass. A `#/` route built from data uses
`encodeURIComponent()` for each part. Filenames from `content-disposition` go through `safeFilename()`. Uploaded
documents are previewed only as PDF, JPEG or PNG (`features/admin/shared/documents.js`); any other type is re-typed
`application/octet-stream`, so it can be downloaded but never rendered in this origin.

Handler names passed to `on()` are always string literals in the source (or a helper's parameter whose callers pass
literals), never data. `invoke()` is only called through an allowlist (`SEARCH_SETTERS`).

### Styles and the CSP

The production `style-src` is `'self'`, with no `'unsafe-inline'`, so markup never carries `style="…"` and nothing writes
a `<style>` element. Sizes, colours, avatar colours (`.ava-0` to `.ava-7`) and bar widths (`.pct-0` to `.pct-100`, from
`pctClass()`) are classes in `styles/styles.scss`. Bootstrap's JS sets `element.style` through the CSSOM, which the CSP
allows. `printDoc()` links the same-origin stylesheets into its window and uses the `.print-doc` body class. `vite dev`
injects the CSS as `<style>` elements, so only the dev server's policy adds `'unsafe-inline'` to `style-src`.
`vite preview` serves the built bundle with production's strict policy.

### Sessions and the API

- The refresh token is an httpOnly cookie scoped to `/api/auth`. Scripts never see it.
- The access token lives only in memory (`core/auth/session-store.js`). A reload gets a new one from the cookie.
- `sessionStorage` (or `localStorage` with "Keep me signed in") holds display details only: name, role, permissions.
- `api()` refreshes the token when it is missing or expired and retries once on a 401. Refreshes are serialised across
  tabs with the Web Locks API, because the server treats a rotated refresh token arriving twice as theft.
- `/auth/*` calls carry the `x-mlaz-csrf` header and the cookie. Every other call omits cookies.

The client owns the refresh-and-retry because it owns the 401 handling. `core/auth/session.js` re-exports
`ensureSession` and `refreshSession`, so features import everything session-related from one module.

## Adding to the UI

**A console page:**

1. Create `features/admin/<page>/<page>.js` with `export async function <page>() { … }` and its `expose({ … })`.
2. Create `features/admin/<page>/index.js` with `export { <page> } from './<page>.js';`.
3. Register it in `features/admin/index.js`: add it to `ADMIN_PAGES`, and add a nav entry with its permission to
   `ADMIN_NAV`. Order matters: the first page the role may open is the default.

Portal pages work the same way in `features/member/`, and public pages in `features/public/index.js` (`PUBLIC`).

**Reusing something across features:**

- A generic piece with no MLAZ meaning goes in `shared/ui`.
- Domain UI used by several areas goes in `features/common` and is exported from its `index.js`.
- Something used by several pages of one area goes in that area's `shared/`.

## How the rules are tested

`npm test` runs both suites with `node --test`. Run it after `npm run build`, so the CSP suite also checks the bundle.

`test/architecture.test.mjs` reads every module's import lines. It fails when:

- a relative import does not resolve, or a named import is not exported by its target;
- `core/` imports `shared/`, `features/` or `app/`;
- `shared/` imports `features/`, `app/`, `core/auth` or `core/api`;
- `features/` imports `app/`;
- a feature is imported other than through its `index.js` (the rule above);
- `fetch(` appears anywhere but `core/api/client.js`;
- a handler name is registered by more than one module;
- there is an import cycle.

A guard test fails if the scan finds implausibly few modules or imports, so a broken regex cannot pass silently.

`test/csp.test.mjs` scans every module under `src/`, recursively. It checks that:

- there are no inline handlers, `javascript:` URLs, eval-like calls or inline `<script>`;
- every handler named in markup is registered with `expose`;
- the dispatcher in `core/events.js` keeps its prototype-free registry and parses arguments with JSON;
- the production, development and preview policies forbid inline script;
- production and preview have `style-src 'self'`, and the dev server differs only by `'unsafe-inline'` in `style-src`;
- the built bundle contains no inline script, eval, `<style>` element or inline style attribute.

`test/ui-safety.test.mjs` covers markup safety:

- `esc()`, `safeUrl()` and `safeFilename()`, with known bypasses (`JaVaScRiPt:`, control characters, `//host`,
  `/\host`, SVG data URLs, blob URLs from other origins);
- the class-name helpers (`icon`, `avatar`, `pctClass`) cannot be broken out of;
- the dispatcher, run against a fake `document`, ignores unregistered and prototype names and arguments that are not a
  JSON array;
- static scans of `src/`: no `style` attributes; every interpolated `href` or `src` uses `esc(safeUrl(…))` or is an
  encoded `#/` route; `checkoutUrl` only reaches `safeUrl(…, 'https')`; no unescaped `${e.message}`; `content-disposition`
  filenames are sanitised; handler names are literals; documents preview only allowlisted types.

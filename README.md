# MLAZ Membership Platform — prototype

Clickable prototype of the Money Lenders Association of Zambia membership platform, built by iZyane.
UI: **Bootstrap 5.3** + **Bootstrap Icons** (themed in `src/styles.scss`), Inter font.

Data is stored in **Supabase** (a shared Postgres table plus a storage bucket for uploaded documents), so
everyone sees the same members, applications and payments, and changes appear live on other devices.
If Supabase isn't configured, the app falls back to this browser's `localStorage`, as in the original
prototype. Use **Reset demo data** (Settings in the Secretariat console) to restore the sample data.

> **Prototype access:** sign-in is still simulated, so anyone with the site's public Supabase key can read
> and change all records and documents. Add Supabase Auth and tighten the policies in
> `supabase/schema.sql` before putting real applicant data in it.

## Set up Supabase (once)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste in `supabase/schema.sql` and run it. It creates the `records` table, the
   `apply_changes` function, live updates and the `docs` storage bucket. It's safe to run again.
3. From **Project Settings → API**, copy the project URL and the `anon` (or publishable) key.
4. Locally: copy `.env.example` to `.env.local` and fill both in.
5. On Netlify: **Site configuration → Environment variables**, add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`, then **Deploys → Trigger deploy** (they're built into the bundle, so a
   redeploy is needed after changing them).

The first visit after setup loads the sample data into the empty database.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the build
```

## Deploy to Netlify

Import the repo in Netlify and accept the detected settings (build `npm run build`, publish `dist`), and
add the two Supabase environment variables above.

## What's in it

| Area | Route | Notes |
| --- | --- | --- |
| Landing page | `#/` | Apply, sign in (member / Secretariat), verify a lender, tiers, news, events |
| Apply | `#/apply` (`#/apply/Gold`) | 4-step application with validation; gives an `APP-` reference |
| Track application | `#/track/APP-2042` | Applicant uploads MoF authorization and pays online |
| Verify / directory | `#/verify/MLA-0421`, `#/directory` | Public lender checks (certificate QR codes link here) |
| Sign in | `#/login/member`, `#/login/admin` | Demo: `info@quicklend.zm` (any member email works) or any `@mlaz.org.zm` address; any password |
| Secretariat console | `#/app/...` | Dashboard, members, applications, certificates, payments, comms, events, settings |
| Member portal | `#/app/...` | Overview, certificates & MoF renewal, dues payment, events, profile |

## Demo script (full lifecycle)

1. **Apply for membership** on the landing page; skip the MoF upload; note the reference.
2. **Track application** with that reference → upload the MoF authorization.
3. **Secretariat sign in** → Applications → open it → *Verify authorization*.
4. Back on **Track application** → pay with mobile money (approval is simulated after a few seconds).
5. Secretariat → Certificates → *Issue*: the certificate (with a working QR code) is generated.
6. **Member sign in** with the applicant's email → download the certificate, pay next year's dues.
7. **Verify a lender** with the new member number.

## Structure

- `src/main.js` — router and app shell (sidebar, top bar)
- `src/public.js` — landing, apply, track, sign in, verify, directory
- `src/admin.js` — Secretariat console pages
- `src/member.js` — member portal pages
- `src/ui.js` — shared state, helpers and Bootstrap components (modals, toasts, payment flow, certificate)
- `src/store.js` — seed data + localStorage persistence (replace with API calls for production)
- `src/styles.scss` — Bootstrap theme variables and custom styles

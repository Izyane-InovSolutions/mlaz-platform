# MLAZ Membership Platform — prototype

Clickable prototype of the Money Lenders Association of Zambia membership platform, built by iZyane.
UI: **Bootstrap 5.3** + **Bootstrap Icons** (themed in `src/styles.scss`), Inter font.

The UI currently runs entirely in the browser. A backend API now lives in [`server/`](server/README.md) and is not yet connected to the UI. Data changes are saved to `localStorage`, so they
survive reloads. Use **Reset demo data** (site footer, or Settings in the Secretariat console) to
restore the sample data.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the build
```

## Deploy to Vercel

Push to GitHub → vercel.com → **Add New → Project** → import the repo → accept the defaults
(Vite is detected: build `npm run build`, output `dist`). Or from the CLI: `npx vercel --prod`.

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

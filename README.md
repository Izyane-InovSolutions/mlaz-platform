# MLAZ Membership Platform

Money Lenders Association of Zambia membership platform, built by iZyane.
UI: **Bootstrap 5.3** + **Bootstrap Icons** (themed in `src/styles.scss`), Inter font. API: [`server/`](server/README.md).

**Integration status.** The public website, sign-in and the **Secretariat console** run on the API.
The console shows each staff member only what their role allows. Approvals use real maker-checker: an officer
recommends, and a *different* person (the Secretariat Admin) approves.
The **member portal** pages still read the prototype's demo data in `localStorage` (`src/store.js`) and are wired next.
Until then, member sign-in only opens the portal for members that also exist in the demo data (the seeded ones, such
as `info@quicklend.zm`).

## Run locally

Start the API first (see [server/README.md](server/README.md) for the one-time database setup):

```bash
cd server && npm run db:up && npm run dev      # API on http://localhost:3000
```

Then the UI, in another terminal:

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the build
```

The UI calls `http://localhost:3000/api` by default. Set `VITE_API_URL` (see `.env.example`) to point it elsewhere.

## Deploy to Vercel

Push to GitHub → vercel.com → **Add New → Project** → import the repo → accept the defaults
(Vite is detected: build `npm run build`, output `dist`). Set `VITE_API_URL` to the deployed API, and add the Vercel
URL to the API's `CORS_ORIGINS` and `PUBLIC_APP_URL`.

## What's in it

| Area | Route | Data |
| --- | --- | --- |
| Landing page | `#/` | API: live stats, tiers and fees, recently accredited, announcements, events |
| Apply | `#/apply` (`#/apply/Gold`) | API: 4-step application with document upload; gives an `APP-` reference |
| Track application | `#/track/APP-2042` | API: opens with the emailed link (`?t=…`) or in the browser used to apply; MoF upload, online payment, bank transfer with proof, certificate and receipt downloads |
| Verify / directory | `#/verify/MLA-0421`, `#/directory` | API: by member number, certificate number or name (certificate QR codes link here) |
| Sign in | `#/login/member`, `#/login/admin` | API: real accounts; demo password from the seed (`Mlaz@2026demo` by default) |
| Set password | `#/set-password?token=…` | API: invite and password-reset links from emails |
| Secretariat console | `#/app/...` | API: dashboard, members, applications (maker-checker), certificates, payments & bank-transfer review, expenses, communications, events, reports, settings & staff accounts |
| Member portal | `#/app/...` | Demo data (being wired) |

## Demo script (full lifecycle, live)

All demo accounts use the seed password (`Mlaz@2026demo` by default).

1. **Apply for membership**; skip the MoF upload; note the reference.
2. **Track application** → upload the MoF authorization.
3. **Secretariat sign in** as `officer@mlaz.org.zm` → Applications → open it → *Recommend approval* (enter the MoF
   expiry date). Sign out.
4. Sign in as `secretariat@mlaz.org.zm` → the same application → *Approve*. (The officer can't approve their own
   recommendation.)
5. Back on **Track application** → pay with mobile money (the sandbox confirms after a few seconds; a number ending
   in `0000` is declined). The certificate is issued automatically. Or pay by bank transfer and upload a proof, then
   sign in as `finance@mlaz.org.zm` → Payments & dues → *Awaiting review* → *Confirm payment*.
6. **Verify a lender** with the new member number, or scan the certificate's QR code.
7. In development, emails are printed in the API's console; the welcome email carries the set-password link.

## Structure

- `src/main.js`: router (sync and async pages, loading and error states) and app shell
- `src/api.js`: API client (tokens, refresh, errors, downloads, tracking tokens)
- `src/checkout.js`: online payment picker and the follow-the-payment dialog
- `src/public.js`: landing, apply, track, sign in, set password, verify, directory
- `src/admin.js`: Secretariat console pages (API, permission-aware)
- `src/member.js`: member portal pages (demo data)
- `src/ui.js`: session, shared helpers and Bootstrap components
- `src/store.js`: demo data + localStorage persistence (removed once the console and portal are wired)
- `src/styles.scss`: Bootstrap theme variables and custom styles

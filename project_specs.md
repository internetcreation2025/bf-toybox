# bf-toybox — Project Specs

## What this is
A sandbox / starter app on the standard IC stack. The product purpose is **not yet
defined** — this repo currently exists to wire up the plumbing (GitHub + Vercel +
Supabase) so real features can be built on top later.

## Who uses it
TBD — to be defined before building features.

## Tech stack
- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack)
- **Styling:** Tailwind CSS
- **Database / Auth:** Supabase (`@supabase/supabase-js` + `@supabase/ssr`)
- **Hosting:** Vercel (auto-deploy from GitHub `main`)
- **Repo:** github.com/internetcreation2025/bf-toybox

## Database
- Currently **reuses the existing `mike-test-app1` Supabase project** (ref
  `cxgzynltxvbhklmzdsge`) to avoid the $10/mo cost of a dedicated DB while this is
  just a toybox.
- **Important:** because the DB is shared, any bf-toybox tables should be clearly
  named (e.g. a `bf_` prefix) so they don't collide with other apps' tables.
- Graduate to a dedicated `bf-toybox` Supabase project when this becomes real.

## Environment variables
| Name | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` + Vercel | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` + Vercel | Supabase publishable key (public) |

`.env.local` holds the real values locally and is git-ignored. `.env.example` is the
committed template. No `service_role` key is stored anywhere in this repo.

## Project structure
- `src/app/page.tsx` — homepage with a live Supabase connection check
- `src/lib/supabase/client.ts` — browser Supabase client
- `src/lib/supabase/server.ts` — server Supabase client (Server Components / Actions)

## Pages / flows
- `/` — public connection-check landing page (placeholder).

## Third-party services
- Supabase (database/auth) — shared `mike-test-app1` project for now
- Vercel (hosting/CI)

## What "done" looks like for the current task (linking/getting started)
- [x] Local repo cloned and Next.js + Supabase scaffolded
- [x] Supabase client wired; connection verified locally (build + runtime)
- [x] Pushed to GitHub `main`
- [ ] Vercel project imported from the repo + env vars added (manual dashboard step)
- [ ] First successful Vercel deployment showing "Supabase connected"

## Next step (to be approved before building)
Define the actual product: what bf-toybox does, who uses it, the data models, and the
first feature to build.

# bf-toybox — Project Specs

## What this is
**"Sole Decider"** — a personal footwear decision-maker game. The user logs the
next few hours of their day and the footwear they have on hand. The app weighs
that context against a catalogue of the user's footwear and issues a **verdict**:
sometimes a straight recommendation (e.g. "trainers, no socks"), sometimes a
randomised **dare** (e.g. barefoot somewhere, slides, socks-only) with a
**photo-proof** requirement. The app recognises the user's own feet from stored
reference images to confirm the proof is genuine, checks the dare's required
elements are present, and archives each completed challenge for later retrieval.

This is a single-user personal app (the owner is the only player).

## Who uses it
The owner only. Adult, self-directed. All photos and feet are the owner's own.
No third parties, no sharing, no public surface.

## Authentication & access control (Phase 0 — built first)
Nothing in the app is reachable without logging in as the owner.
- **Supabase Auth** with **passwordless magic link** (email one-time link). Built
  first. **Google OAuth** added as a fast-follow once Google Cloud OAuth
  credentials exist.
- **Single-user allowlist:** only the owner's email (`info@internetcreation.net`)
  is permitted to sign in; any other authenticated email is rejected at
  middleware and signed out. Enforced via a server env var `ALLOWED_EMAIL`.
- **Route protection:** Next.js middleware refreshes the Supabase session and
  redirects unauthenticated requests to `/login`. All `/api/*` AI routes check the
  session server-side before doing anything.
- **Row-Level Security** on every `bf_*` table so rows are only readable/writable
  by the owner's `auth.uid()`.

## Tech stack
- **Framework:** Next.js 16 (App Router, TypeScript, Tailwind) — already scaffolded
- **Database/Storage:** Supabase (reusing `mike-test-app1`, ref `cxgzynltxvbhklmzdsge`); all tables `bf_`-prefixed; a private Storage bucket `bf-feet` for images (served via short-lived signed URLs)
- **AI:** Claude Opus 4.8 (`claude-opus-4-8`) vision, called **server-side only** from Next.js Route Handlers via the official `@anthropic-ai/sdk`. The Anthropic API key lives in a server env var, never in the browser.
- **Hosting:** Vercel (auto-deploy from GitHub `main`)

## Core data models (Supabase, `bf_` prefix)
- `bf_footwear` — the catalogue: `id, name, category, colour, notes, photo_path, created_at`. Categories: `barefoot, socks, slides, flip_flops, trainers, boots, dress_shoes, sandals, other`.
- `bf_foot_refs` — reference images of the owner's feet, one row per angle: `id, angle, photo_path, ai_fingerprint (text), created_at`. This is the "visual memory."
- `bf_challenges` — every verdict issued: `id, created_at, schedule_json, available_footwear_json, weights_json, verdict_type ('wear'|'dare'), rarity ('common'|'uncommon'|'rare'|'epic'), instruction, proof_required_json, status ('issued'|'sealed'|'submitted'|'verified'|'failed'|'expired'), sealed_until (timestamp, for mystery envelopes), proof_photo_path, verification_json, archived_at`.
- `bf_streak` — single-row game state: `current_streak, longest_streak, freeze_tokens, last_result_at`.
- `bf_achievements` — unlocked badges: `id, key, label, unlocked_at`.
- `bf_settings` — single-row config: `weights_json, dare_window_minutes, persona ('butler'|'gremlin'|'sergeant'), notifications_enabled`.
- `bf_push_subscriptions` — web-push endpoints for timed envelope alerts: `id, subscription_json, created_at`.

## The "visual memory" (foot recognition) — and its honest limits
On setup, the owner uploads reference photos of their feet from a fixed set of
angles. For each, Claude writes a **detailed textual fingerprint** (toe-length
ordering, nail shape, freckles/moles/scars, vein patterns, skin tone, arch
shape) which is stored in `bf_foot_refs.ai_fingerprint`. When a proof photo comes
in, Claude compares it against those fingerprints and returns a **match
confidence + reasoning**.

**Limit, stated plainly:** this is a strong *heuristic* match (good enough to
catch "that's not your foot" in a personal game), **not** forensic biometric
identification. It can be fooled and isn't a security control. That's an
acceptable tradeoff for a single-player game; it is documented so nobody mistakes
it for real biometrics.

### Reference angles I will ask for (8)
Barefoot, clean feet, plain background, even lighting:
1. Top of **left** foot (dorsum)  2. Top of **right** foot
3. Sole of **left** foot          4. Sole of **right** foot
5. **Left** foot outer side profile  6. **Right** foot outer side profile
7. **Both** feet from directly above, toes relaxed
8. **Heels** from behind (Achilles/ankle)

## The decision / dare engine
1. **Schedule intake** — the app asks for the next **4 hours, hour by hour, with
   no gaps** (it rejects submission until every hour 0–4 has an activity +
   location). Stored in `schedule_json`.
2. **Footwear-on-hand intake** — the app asks which items from the catalogue (or
   ad-hoc) are physically available right now.
3. **Weighted random outcome** — done in code, with tunable **rarity tiers**
   (weights the owner can adjust in settings):
   - *Common* — normal shoes + socks
   - *Uncommon* — socks only / shoes no socks / slides
   - *Rare* — flip-flops out / barefoot for a short window
   - *Epic* — a context-aware **barefoot dare with photo proof**
   Weights bias the roll; the schedule conditions it (e.g. a "café" slot can
   spawn the Starbucks-style dare). Claude writes the verdict's wording and, for
   dares, the specific proof requirements tied to the real schedule.
4. **Proof requirement** (dares only) — e.g. "tops of bare feet, [context object]
   visible in background, today's date written on the foot in pen." Stored in
   `proof_required_json`.

## Proof verification flow
Owner uploads the proof photo → server Route Handler sends it to Claude with the
stored foot fingerprints and the dare's `proof_required_json` → Claude returns:
`{ is_owner_feet, match_confidence, required_elements: [{name, present}], verdict, reasoning }`.
On pass → `status='verified'`, streak +1, archived. On fail → `status='failed'`,
streak reset. A time window can expire an unanswered dare (`status='expired'`).

## What makes the game interesting (design)
Core:
- **Rarity-tier loot feel** — you never know if today is a boring day or a dare day.
- **Context-aware dares** tied to your actual schedule, not generic.
- **Proof-or-forfeit + streaks** — a real reason to follow through; failures sting.
- **Anti-cheat via foot-match** — proof actually means something.
- **Archive / gallery** — a retrospective of completed dares with photos + dates.
- **Tunable spice** — weight sliders so you control how often dares fire.

Quirky features included in v1 (all selected):
- **Loot-box reveal** — verdicts drop with a scratch-card/slot-machine animation
  and rarity colours.
- **Decider persona** — a chosen character voice (deadpan butler / chaos gremlin /
  drill sergeant) that reskins all flavour text; set in Settings, applied to every
  Claude-authored verdict via the system prompt.
- **Double-or-nothing** — after a verdict, gamble a re-roll for a spicier dare with
  larger streak swings both ways.
- **Forensic verdict card** — proof checks render the AI's match % + reasoning,
  CSI-style ("toe-length ratio consistent; freckle on 2nd metatarsal confirmed").
- **Achievements + stats** — badges (first barefoot proof, 7-day streak,
  busted-a-fake) and a stats dashboard (barefoot-hours, most-worn footwear, dare
  success rate, rarity history).
- **Weather-aware dares** — live weather/temperature for the owner's location feed
  the dare author (e.g. "it's raining — barefoot in it").
- **Timed mystery envelope** — a sealed dare scheduled for a future hour that
  unlocks and notifies at go-time (web push).
- **Streak-freeze tokens** — earned by completing dares, spent to save a streak.

## Pages / flows
- `/login` — magic-link sign-in (Google button added later); allowlist-gated
- `/` — dashboard: streak, freeze-token count, "Roll my next 4 hours" button, any sealed mystery envelope, recent archive
- `/catalogue` — manage footwear (add/edit, photo upload)
- `/feet` — upload/replace the 8 reference angles (the visual memory)
- `/roll` — schedule intake (no gaps) → footwear-on-hand → loot-box verdict reveal → optional double-or-nothing
- `/proof/[challengeId]` — upload proof → forensic verdict card
- `/archive` — completed challenges gallery
- `/stats` — stats dashboard + achievements/badges
- `/settings` — rarity weights, dare time-window, Decider persona, notification opt-in

## Environment variables
| Name | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + Vercel | Supabase URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + Vercel | Supabase publishable key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** + Vercel | server-side Storage/DB writes (NEVER in client) |
| `ANTHROPIC_API_KEY` | **server only** + Vercel | Claude vision calls (NEVER in client) |
| `ALLOWED_EMAIL` | **server only** + Vercel | the single email permitted to log in |
| `OPENWEATHER_API_KEY` | **server only** + Vercel | live weather for weather-aware dares |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | server + Vercel | web push for timed mystery-envelope alerts |

## Build phases
- **Phase 0 — Auth gate:** Supabase magic-link login, `/login`, middleware route
  protection, `ALLOWED_EMAIL` allowlist, RLS on all tables. (Google OAuth: fast-follow.)
- **Phase 1 — Catalogue + Visual Memory:** `bf_footwear` + `bf_foot_refs` tables, Storage bucket, `/catalogue` and `/feet` pages, AI fingerprinting of reference photos.
- **Phase 2 — Decision/Dare Engine:** `/roll` (no-gap schedule + footwear-on-hand), weighted engine, **loot-box reveal**, **weather-aware** + **persona-voiced** Claude verdict/dare authoring, **double-or-nothing**, `bf_challenges`.
- **Phase 3 — Proof + Archive:** `/proof/[id]` upload + Claude verification with **forensic verdict card** (foot-match + element check), streaks + **freeze tokens**, `/archive` gallery.
- **Phase 4 — Extras:** **achievements + stats** (`/stats`), **timed mystery envelope** + web-push notifications, `/settings` (weights, persona, dare window), Google OAuth.

## What "done" looks like (whole app)
Owner can: maintain a footwear catalogue and a set of foot reference angles; press
one button to log the next 4 hours and available footwear; receive a weighted
verdict (sometimes a dare); submit photo proof that the app verifies as their own
feet with the required elements; and browse an archive of completed challenges —
all live on Vercel.

## Notes / decisions
- Single-user, private; no auth in v1 (add a simple gate before any public exposure).
- Shared DB → all tables `bf_`-prefixed to avoid colliding with `mike-test-app1`.
- Foot-matching is heuristic, not biometric security (documented above).

## Phase 5 — Wear tracking, footwear dossier & foot care (2026-06-11, approved)
**Who/why:** Mike wants the Decider to reason from the real state of his footwear, not guesswork.

- **Wear state on every footwear item (`bf_footwear`):** `worn_hours` (since last wash), `played_count` (sport sessions since wash), `dried_count` (wet-then-dried re-wears since wash — smell intensifier), `sockless_count` (lifetime times this shoe worn bare), `last_worn_at`, `last_washed_at`. A **wash resets** worn_hours/played/dried. Wear is **logged in rough hours by Mike** (his choice) when he marks a verdict done, plus manual catalogue controls (Log wear / Mark washed).
- **Footwear dossier (`bf_footwear.dossier` jsonb):** when a photo is uploaded, Claude profiles it — material, breathability, formality, condition, one-line summary. Drives the smell model (leather + sockless + warm = ripe fast; mesh stays sweeter), "dress for the occasion", and deliberate rotation.
- **Decider picks specific items:** roll sends the catalogue with dossier + wear-state; the Decider names which shoes AND which socks to wear (or sockless), tied to the occasion/attire (no dress shoes with shorts). Choice stored in `bf_challenges.wear_json` so "mark done" can log wear against those items.
- **Currently wearing:** optional picker on the roll screen so the Decider knows what's already on (and today's wear still counts).
- **Foot maintenance:** the Decider watches foot condition (notes + proof close-ups) and occasionally sets upkeep (trim a nail, file hard skin, moisturise) — can diarise it and ask for an "after" close-up. Rides existing prep/diary memory; no new table.
- **Schema Mike runs himself** (classifier blocks me): bf_footwear wear columns + `dossier jsonb`; `bf_challenges.wear_json jsonb`.

## Phase 6 — The Foot Chronicle (2026-06-12, approved)
**Who/why:** Mike wants the app reframed (per a ChatGPT brief) as a chronological audit / lifecycle archive / game-master, *additively* — only the parts that genuinely expand what exists. Most of the brief (catalogue, compatibility rules, proof, badges, streaks, freshness) was already live and is left untouched. Five additions were approved.

- **The Chronicle (`/chronicle`):** one read-only, dated "life of your feet" feed that merges every recorded event into a single timeline — rolls/verdicts (with status), sock wears & washes (from `bf_sock_log`), diary/prep/scheduled-game items, and gallery shots filed for the Roaster. Grouped by day, newest first, capped ~150 events. No schema change.
- **Weekly digest:** the Archivist reads the last 7 days and writes a short dramatic recap (sock of the week, milestones, ripe moments) — `POST /api/chronicle/digest`, stored in `bf_memory` as `kind='digest'` (title = prose, game_on = week-ending date). Surfaced at the top of the Chronicle via `DigestPanel`. On-demand (could be wired to cron later). No schema change.
- **Sock biographies:** the Archivist writes each sock an evolving narrative from its real history (wears, hours, washes, sport, what shoes it's been paired with via `bf_challenges.wear_json`, peak smell) — `POST /api/footwear/biography`, stored on `bf_footwear.bio` / `bio_updated_at`. Shown per-sock in the catalogue.
- **Sock lifecycle status:** every sock derives a stage — **clean / resting / in-rotation / overdue / retired** (`src/lib/socks.ts`, single source of truth). Shown as a chip in the catalogue with a Retire/Bring-back toggle (`bf_footwear.retired`). The Decider sees "OVERDUE for a wash" / "RETIRED (don't assign)" on the roll line and is told to wash/rest/rotate or use overdue socks for a deliberate smell dare, and never assign retired ones.
- **The Archivist voice:** a 4th persona alongside therapist/gremlin/roaster — solemn forensic curator. Plus a **safety/health guardrail** added to the Decider's base brief: ease off and switch to foot care (and suggest a pharmacist/doctor) on any sign of pain, blister, cut, broken skin or infection; nothing risking injury, infection or public indecency.

- **Schema Mike runs himself** (classifier blocks me): `bf_footwear` add `retired boolean default false`, `bio text`, `bio_updated_at timestamptz`. Everything is written resiliently so it no-ops gracefully before the SQL is run.

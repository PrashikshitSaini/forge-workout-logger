# Forge — smart workout logger (PWA)

A fast, utilitarian workout logger you install on your phone. Open it, tap your
day, and last week's exercises + weights are pre-filled as editable placeholders —
log a set in a couple of taps. An AI coach reads your real numbers and drops a
terse, useful observation when you open the app; tap it to chat.

- **Day-wise routines** inside named **regimes** (training blocks). Change your
  whole program and the old block is archived intact — exercise history flows
  across regimes.
- **Smart pre-fill** clones your most recent session of that routine.
- **Dated note history** keeps prior workout and per-exercise notes available
  during the next session instead of replacing the diary trail.
- **Reports**: weekly volume, volume by muscle, consistency, bodyweight trend.
- **AI coach** (OpenRouter): insight-on-open + chat, grounded in your data.
- **Conversational meal logging**: describe a meal naturally; OpenRouter web
  search researches branded labels, itemizes it, and logs daily macros + sources.
- **Inline meal corrections**: edit a logged meal's title, ingredients, serving
  text, and macro values directly in its card when the researched result needs a correction.
- **PWA**: installs to your Android home screen, works offline-tolerant.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase
(Postgres + Auth, RLS) · OpenRouter (server-side).

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the migrations in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_functions.sql`
   - `supabase/migrations/0003_start_session.sql`
   - `supabase/migrations/0004_daily_health.sql`
   - `supabase/migrations/0005_meals.sql`
   - `supabase/migrations/0006_atomic_workout_edits.sql`
   - `supabase/migrations/0007_unify_daily_health.sql`
   - `supabase/migrations/0008_atomic_meal_research_updates.sql`
   - `supabase/migrations/0009_durable_meals_and_reuse.sql`
   - `supabase/migrations/0010_fix_durable_meal_rpc_privileges.sql`
   - `supabase/migrations/0011_disable_background_meal_research.sql`
   - `supabase/migrations/0012_workout_export_credentials.sql`
3. **Auth → Providers → Email**: ensure Email is enabled (magic link). For local
   testing, add `http://localhost:3000/**` under **Auth → URL Configuration →
   Redirect URLs** (and your production URL when you deploy).

### 2. Environment

Copy the example and fill it in:

```bash
cp .env.example .env.local
```

| Variable | Where |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page (anon/public key) |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) — **server-side only** |
| `OPENROUTER_MODEL` | any model id, e.g. `openai/gpt-4o-mini` (default) |
| `MEAL_LOGGER_MODEL` | no longer used; meal research uses `google/gemini-2.5-flash` with a web lookup and a no-web fallback |
| `NEXT_PUBLIC_SITE_URL` | your URL (used in OpenRouter attribution) |

### 3. Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, sign in with the magic link, and on first run choose
**Seed my Monday** to load the chest day. Build the other days from the **Settings →
Routines** screen.

## Install on Android

Open the deployed URL in Chrome → menu → **Add to Home screen**. It launches
full-screen like a native app.

## Health stats / MacroDroid

A PWA can't read Samsung Health or a Galaxy Watch directly, so MacroDroid sends
daily weight, steps, calories, sleep, distance, and heart-rate data to
`/api/health-sync`. The **Stats** tab keeps that data in one editable timeline;
the AI uses the same consolidated values to relate recovery to training.
For structured sync payloads, send weight as `bodyweight` in the app's configured
weight unit alongside the existing health fields.

## Workout export for curl and automations

After applying migration `0012_workout_export_credentials.sql`, sign in and open
**Settings → Workout export API**. Choose a password there; the app stores only
a salted hash and gives your account an unguessable endpoint URL. No separate
deployment-level export token or user ID is required.

```bash
curl --fail --silent --show-error \
  -u 'forge:YOUR_EXPORT_PASSWORD' \
  "https://your-forge-domain.example/api/workouts/export/YOUR_ENDPOINT_ID?from=2026-01-01" \
  -o workouts.json
```

The JSON includes every matching workout (including unfinished sets), a compact
summary, and chronological per-exercise trend entries with completed-set counts,
reps, strength volume, best weight, estimated one-rep max, and cardio duration.
`from` and `to` are optional `YYYY-MM-DD` filters; with neither, the full
workout history is returned. Change the password at any time in Settings; choose
**Rotate the endpoint URL** there if a link is exposed. Never put the password
in a browser URL or commit it.

## Deploy (Vercel)

Push to a Git repo, import into Vercel, set the same environment variables in the
project settings, and add your production URL to Supabase's redirect allow-list.

## Project layout

```
app/
  (app)/            authenticated screens (log, history, reports, stats, settings, routines)
  api/ai-chat/      OpenRouter proxy (key stays server-side, per-user rate limited)
  api/meals/analyze OpenRouter web research → validated, atomic meal storage
  api/meals/[id]    inline authenticated meal and macro corrections
  auth/callback/    magic-link PKCE exchange
  login/            magic-link sign-in
components/         UI primitives, log flow, routines, charts, coach
lib/                supabase clients, queries, mutations, reports, AI context
supabase/migrations schema, RLS, and the switch_regime / start_session functions
```

# Forge — smart workout logger (PWA)

A fast, utilitarian workout logger you install on your phone. Open it, tap your
day, and last week's exercises + weights are pre-filled as editable placeholders —
log a set in a couple of taps. An AI coach reads your real numbers and drops a
terse, useful observation when you open the app; tap it to chat.

- **Day-wise routines** inside named **regimes** (training blocks). Change your
  whole program and the old block is archived intact — exercise history flows
  across regimes.
- **Smart pre-fill** clones your most recent session of that routine.
- **Reports**: weekly volume, volume by muscle, consistency, bodyweight trend.
- **AI coach** (OpenRouter): insight-on-open + chat, grounded in your data.
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

## Body stats / Samsung Health

A PWA can't read Samsung Health or a Galaxy Watch directly (that's a native-only
Android API with no web bridge). Enter the few stats that matter — bodyweight,
sleep, resting HR — by hand on the **Stats** tab; the AI uses them to relate
recovery to your lifts. A CSV-import path can be added later if you want it.

## Deploy (Vercel)

Push to a Git repo, import into Vercel, set the same environment variables in the
project settings, and add your production URL to Supabase's redirect allow-list.

## Project layout

```
app/
  (app)/            authenticated screens (log, history, reports, stats, settings, routines)
  api/ai-chat/      OpenRouter proxy (key stays server-side, per-user rate limited)
  auth/callback/    magic-link PKCE exchange
  login/            magic-link sign-in
components/         UI primitives, log flow, routines, charts, coach
lib/                supabase clients, queries, mutations, reports, AI context
supabase/migrations schema, RLS, and the switch_regime / start_session functions
```

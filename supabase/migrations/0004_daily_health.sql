-- Forge — daily_health
-- Passive day-level metrics synced from a wearable (Galaxy Watch → Samsung
-- Health → Health Connect → a phone automation that POSTs /api/health-sync).
--
-- This table owns ALL watch-sourced metrics. The existing `body_stats` table
-- stays the home for MANUAL entries (bodyweight, body fat, and hand-typed
-- sleep / resting HR). Keeping the two sources in separate tables means neither
-- write path can silently clobber the other; the UI shows them side by side.
-- Re-runnable: guards make it safe to apply more than once.

create table if not exists daily_health (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recorded_on    date not null default current_date,
  steps          integer       check (steps is null or steps between 0 and 200000),
  active_kcal    numeric(7, 1) check (active_kcal is null or active_kcal between 0 and 30000),
  total_kcal     numeric(7, 1) check (total_kcal is null or total_kcal between 0 and 30000),
  distance_m     numeric(9, 1) check (distance_m is null or distance_m between 0 and 1000000),
  sleep_minutes  integer       check (sleep_minutes is null or sleep_minutes between 0 and 1440),
  resting_hr     smallint      check (resting_hr is null or resting_hr between 0 and 250),
  avg_hr         smallint      check (avg_hr is null or avg_hr between 0 and 250),
  source         text not null default 'health_connect',
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (user_id, recorded_on)
);
create index if not exists daily_health_user_date_idx
  on daily_health (user_id, recorded_on desc);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Same owner-only policy as every other table. The /api/health-sync endpoint
-- writes with the service-role key (which bypasses RLS) and sets user_id
-- explicitly server-side, so ingestion does not depend on an auth session.
alter table daily_health enable row level security;
drop policy if exists daily_health_owner on daily_health;
create policy daily_health_owner on daily_health for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

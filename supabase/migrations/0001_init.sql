-- Forge — initial schema
-- Model: Regime → day-wise Routines → Sessions → Sets, plus an Exercise catalog
-- and Body Stats. Exercise history spans regimes; old regimes are archived, not
-- deleted. Re-runnable: guards make it safe to apply more than once.

-- ── Enums ────────────────────────────────────────────────────────────────────
do $$ begin
  create type exercise_type as enum ('strength', 'cardio');
exception when duplicate_object then null; end $$;

-- ── Regimes (training blocks) ─────────────────────────────────────────────────
create table if not exists regimes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  notes       text,
  started_on  date not null default current_date,
  ended_on    date,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists regimes_user_idx on regimes (user_id);
-- At most one active regime per user.
create unique index if not exists regimes_one_active_per_user
  on regimes (user_id) where is_active;

-- ── Exercise catalog (spans regimes) ──────────────────────────────────────────
create table if not exists exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null,
  muscle_group  text,
  equipment     text,
  type          exercise_type not null default 'strength',
  created_at    timestamptz not null default now()
);
create index if not exists exercises_user_idx on exercises (user_id);
create unique index if not exists exercises_user_name_uniq
  on exercises (user_id, lower(name));

-- ── Routines (day templates within a regime) ──────────────────────────────────
create table if not exists routines (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  regime_id    uuid not null references regimes (id) on delete cascade,
  day_of_week  smallint check (day_of_week between 0 and 6),
  name         text not null,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists routines_regime_idx on routines (regime_id);
create index if not exists routines_user_day_idx on routines (user_id, day_of_week);

create table if not exists routine_exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  routine_id    uuid not null references routines (id) on delete cascade,
  exercise_id   uuid not null references exercises (id) on delete restrict,
  position      integer not null default 0,
  target_sets   smallint,
  target_reps   text,
  created_at    timestamptz not null default now()
);
create index if not exists routine_exercises_routine_idx on routine_exercises (routine_id);

-- ── Sessions (a logged workout) ───────────────────────────────────────────────
create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  regime_id     uuid not null references regimes (id) on delete cascade,
  routine_id    uuid references routines (id) on delete set null,
  performed_on  date not null default current_date,
  notes         text,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists sessions_user_date_idx on sessions (user_id, performed_on desc);
create index if not exists sessions_regime_idx on sessions (regime_id);
create index if not exists sessions_routine_idx on sessions (routine_id);

create table if not exists session_exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id    uuid not null references sessions (id) on delete cascade,
  exercise_id   uuid not null references exercises (id) on delete restrict,
  position      integer not null default 0,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists session_exercises_session_idx on session_exercises (session_id);
create index if not exists session_exercises_exercise_idx on session_exercises (exercise_id);

create table if not exists sets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_exercise_id uuid not null references session_exercises (id) on delete cascade,
  set_number          smallint not null default 1,
  weight              numeric(6, 2),   -- strength load (unit-less; displayed as lb)
  reps                smallint,        -- strength reps
  rpe                 numeric(3, 1),   -- optional effort 1-10
  duration_seconds    integer,         -- cardio
  level               numeric(5, 1),   -- cardio intensity/level
  done                boolean not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists sets_session_exercise_idx on sets (session_exercise_id);

-- ── Body stats (manual entry) ─────────────────────────────────────────────────
create table if not exists body_stats (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recorded_on  date not null default current_date,
  bodyweight   numeric(6, 2),
  body_fat     numeric(4, 1),
  sleep_hours  numeric(3, 1),
  resting_hr   smallint,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (user_id, recorded_on)
);
create index if not exists body_stats_user_date_idx on body_stats (user_id, recorded_on desc);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Every table carries user_id, so one policy per table covers all operations.
do $$
declare t text;
begin
  foreach t in array array[
    'regimes','exercises','routines','routine_exercises',
    'sessions','session_exercises','sets','body_stats'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_owner', t);
    execute format(
      'create policy %I on %I for all
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()));',
      t || '_owner', t
    );
  end loop;
end $$;

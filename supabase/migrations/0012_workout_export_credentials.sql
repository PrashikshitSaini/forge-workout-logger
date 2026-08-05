-- Personal curl-export credentials. The endpoint id is public-but-unguessable;
-- the password is a salted scrypt hash and is never readable through RLS.
create table if not exists workout_export_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  endpoint_id uuid not null unique default gen_random_uuid(),
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workout_export_credentials enable row level security;
revoke all on table workout_export_credentials from public, anon, authenticated;

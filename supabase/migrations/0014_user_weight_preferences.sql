-- Per-user display preferences. Historical workout loads remain stored in lb.
create table if not exists user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  weight_unit text not null default 'lb' check (weight_unit in ('lb', 'kg')),
  updated_at timestamptz not null default now()
);

alter table user_preferences enable row level security;

drop policy if exists user_preferences_owner on user_preferences;
create policy user_preferences_owner on user_preferences
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

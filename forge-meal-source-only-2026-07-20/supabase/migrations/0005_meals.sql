-- Forge — conversational meal logging
-- One natural-language entry becomes a meal with itemized, source-aware macros.
-- The API validates the AI result before calling create_meal, and this RPC keeps
-- the parent meal + its items atomic under the signed-in user's RLS identity.

create table if not exists meals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  logged_on       date not null default current_date,
  meal_type       text not null default 'meal'
                    check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'meal')),
  title           text not null,
  original_input  text not null,
  assumptions     text[] not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists meals_user_date_idx on meals (user_id, logged_on desc, created_at desc);

create table if not exists meal_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meal_id       uuid not null references meals (id) on delete cascade,
  name          text not null,
  brand         text,
  quantity      text not null,
  calories      numeric(8, 2) not null check (calories between 0 and 100000),
  protein_g     numeric(8, 2) not null check (protein_g between 0 and 10000),
  carbs_g       numeric(8, 2) not null check (carbs_g between 0 and 10000),
  fat_g         numeric(8, 2) not null check (fat_g between 0 and 10000),
  fiber_g       numeric(8, 2) check (fiber_g is null or fiber_g between 0 and 10000),
  source_url    text,
  source_title  text,
  confidence    text not null default 'medium'
                  check (confidence in ('high', 'medium', 'low')),
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists meal_items_meal_idx on meal_items (meal_id, position);

alter table meals enable row level security;
drop policy if exists meals_owner on meals;
create policy meals_owner on meals for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table meal_items enable row level security;
drop policy if exists meal_items_owner on meal_items;
create policy meal_items_owner on meal_items for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function create_meal(
  p_logged_on date,
  p_meal_type text,
  p_title text,
  p_original_input text,
  p_assumptions text[],
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_meal_id uuid;
  v_item jsonb;
  v_position integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_original_input), '') = '' then
    raise exception 'meal title and input are required';
  end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'meal') then
    raise exception 'invalid meal type';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one meal item is required';
  end if;

  insert into meals (user_id, logged_on, meal_type, title, original_input, assumptions)
  values (v_uid, p_logged_on, p_meal_type, btrim(p_title), btrim(p_original_input), coalesce(p_assumptions, '{}'))
  returning id into v_meal_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into meal_items (
      user_id, meal_id, name, brand, quantity, calories, protein_g, carbs_g,
      fat_g, fiber_g, source_url, source_title, confidence, position
    ) values (
      v_uid,
      v_meal_id,
      btrim(v_item->>'name'),
      nullif(btrim(v_item->>'brand'), ''),
      btrim(v_item->>'quantity'),
      (v_item->>'calories')::numeric,
      (v_item->>'protein_g')::numeric,
      (v_item->>'carbs_g')::numeric,
      (v_item->>'fat_g')::numeric,
      nullif(v_item->>'fiber_g', '')::numeric,
      nullif(btrim(v_item->>'source_url'), ''),
      nullif(btrim(v_item->>'source_title'), ''),
      coalesce(nullif(v_item->>'confidence', ''), 'medium'),
      v_position
    );
    v_position := v_position + 1;
  end loop;

  return v_meal_id;
end $$;

grant execute on function create_meal(date, text, text, text, text[], jsonb) to authenticated;

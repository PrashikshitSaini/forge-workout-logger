-- Durable meal research and reusable meal snapshots. This migration is additive:
-- existing synchronous meal logging continues to use create_meal/replace_meal.

alter table meals
  add column if not exists nutrition_status text not null default 'legacy'
    check (nutrition_status in ('legacy', 'confirmed', 'estimate')),
  add column if not exists research_job_id uuid,
  add column if not exists source_reusable_meal_id uuid,
  add column if not exists source_reusable_meal_revision integer,
  add column if not exists source_meal_id uuid references meals(id) on delete set null;

create unique index if not exists meals_research_job_once_idx
  on meals (research_job_id) where research_job_id is not null;

create table if not exists reusable_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  meal_type text not null default 'meal'
    check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'meal')),
  original_input text not null,
  assumptions text[] not null default '{}',
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  nutrition_status text not null check (nutrition_status in ('legacy', 'confirmed', 'estimate')),
  revision integer not null default 1 check (revision > 0),
  source_meal_id uuid references meals(id) on delete set null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists reusable_meals_owner_name_idx
  on reusable_meals (user_id, lower(btrim(name)));
create index if not exists reusable_meals_owner_recent_idx
  on reusable_meals (user_id, last_used_at desc nulls last, updated_at desc);

alter table reusable_meals enable row level security;
drop policy if exists reusable_meals_owner_read on reusable_meals;
create policy reusable_meals_owner_read on reusable_meals for select
  using (user_id = (select auth.uid()));

create table if not exists meal_research_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null,
  kind text not null check (kind in ('create', 'replace')),
  target_meal_id uuid references meals(id) on delete set null,
  logged_on date not null,
  client_timezone text not null default 'UTC',
  original_input text not null check (btrim(original_input) <> ''),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'retry_wait', 'succeeded', 'needs_review', 'discarded')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 6 check (max_attempts between 1 and 12),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  lock_token uuid,
  draft_analysis jsonb,
  last_error_code text,
  last_error_message text,
  result_meal_id uuid references meals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);
create index if not exists meal_research_jobs_due_idx
  on meal_research_jobs (status, next_attempt_at)
  where status in ('queued', 'retry_wait');
create index if not exists meal_research_jobs_owner_idx
  on meal_research_jobs (user_id, created_at desc);

alter table meal_research_jobs enable row level security;
drop policy if exists meal_research_jobs_owner_read on meal_research_jobs;
create policy meal_research_jobs_owner_read on meal_research_jobs for select
  using (user_id = (select auth.uid()));

-- Browser users may only see rows. All state-changing operations go through
-- narrowly granted functions below.
revoke all on table meal_research_jobs, reusable_meals from public, anon, authenticated;
grant select on meal_research_jobs, reusable_meals to authenticated;

create or replace function enqueue_meal_research(
  p_idempotency_key uuid,
  p_request_hash text,
  p_logged_on date,
  p_client_timezone text,
  p_original_input text,
  p_kind text default 'create',
  p_target_meal_id uuid default null
)
returns meal_research_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := (select auth.uid()); v_job meal_research_jobs;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_kind not in ('create', 'replace') then raise exception 'invalid meal research kind'; end if;
  if btrim(p_original_input) = '' then raise exception 'meal input is required'; end if;
  if p_kind = 'replace' and not exists (select 1 from meals where id = p_target_meal_id and user_id = v_uid) then
    raise exception 'meal not found';
  end if;
  insert into meal_research_jobs (user_id, idempotency_key, request_hash, kind, target_meal_id, logged_on, client_timezone, original_input)
  values (v_uid, p_idempotency_key, p_request_hash, p_kind, p_target_meal_id, p_logged_on, left(coalesce(nullif(btrim(p_client_timezone), ''), 'UTC'), 100), btrim(p_original_input))
  on conflict (user_id, idempotency_key) do update set updated_at = meal_research_jobs.updated_at
  returning * into v_job;
  if v_job.request_hash <> p_request_hash then raise exception 'idempotency key was reused for a different request'; end if;
  return v_job;
end $$;

create or replace function claim_due_meal_research_job()
returns meal_research_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_job meal_research_jobs;
begin
  select * into v_job from meal_research_jobs
  where (status in ('queued', 'retry_wait') and next_attempt_at <= now())
     or (status = 'running' and lease_expires_at < now())
  order by next_attempt_at, created_at
  for update skip locked limit 1;
  if v_job.id is null then return null; end if;
  update meal_research_jobs set status = 'running', attempt_count = v_job.attempt_count + 1,
    lock_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes', updated_at = now()
  where id = v_job.id returning * into v_job;
  return v_job;
end $$;

create or replace function resolve_meal_research_job(
  p_job_id uuid, p_lock_token uuid, p_outcome text, p_result jsonb default null,
  p_error_code text default null, p_error_message text default null, p_delay_seconds integer default 0
)
returns meal_research_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_job meal_research_jobs;
begin
  select * into v_job from meal_research_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'running' or v_job.lock_token is distinct from p_lock_token then
    raise exception 'meal research lease is no longer valid';
  end if;
  if p_outcome = 'retry' and v_job.attempt_count < v_job.max_attempts then
    update meal_research_jobs set status='retry_wait', next_attempt_at=now()+make_interval(secs => greatest(1, p_delay_seconds)),
      lease_expires_at=null, lock_token=null, last_error_code=p_error_code, last_error_message=left(p_error_message, 500), updated_at=now()
    where id=p_job_id returning * into v_job;
  elsif p_outcome in ('review', 'discard') then
    update meal_research_jobs set status=case when p_outcome='discard' then 'discarded' else 'needs_review' end,
      draft_analysis=p_result, lease_expires_at=null, lock_token=null, last_error_code=p_error_code,
      last_error_message=left(p_error_message, 500), completed_at=now(), updated_at=now()
    where id=p_job_id returning * into v_job;
  else
    raise exception 'use finalize_meal_research_job for successful research';
  end if;
  return v_job;
end $$;

-- Finalization intentionally owns the meal write, so a duplicate worker run
-- cannot create a second meal after a provider timeout.
create or replace function finalize_meal_research_job(p_job_id uuid, p_lock_token uuid, p_result jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_job meal_research_jobs; v_meal_id uuid; v_item jsonb; v_position integer := 0;
begin
  select * into v_job from meal_research_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status <> 'running' or v_job.lock_token is distinct from p_lock_token then raise exception 'meal research lease is no longer valid'; end if;
  if jsonb_typeof(p_result->'items') <> 'array' or jsonb_array_length(p_result->'items') = 0 then raise exception 'at least one meal item is required'; end if;
  if v_job.kind = 'replace' then
    select id into v_meal_id from meals where id=v_job.target_meal_id and user_id=v_job.user_id for update;
    if v_meal_id is null then raise exception 'meal not found'; end if;
    delete from meal_items where meal_id=v_meal_id and user_id=v_job.user_id;
    update meals set logged_on=v_job.logged_on, meal_type=p_result->>'meal_type', title=btrim(p_result->>'title'), original_input=v_job.original_input,
      assumptions=coalesce(array(select jsonb_array_elements_text(p_result->'assumptions')), '{}'), nutrition_status='confirmed', research_job_id=v_job.id
    where id=v_meal_id;
  else
    insert into meals (user_id, logged_on, meal_type, title, original_input, assumptions, nutrition_status, research_job_id)
    values (v_job.user_id, v_job.logged_on, p_result->>'meal_type', btrim(p_result->>'title'), v_job.original_input,
      coalesce(array(select jsonb_array_elements_text(p_result->'assumptions')), '{}'), 'confirmed', v_job.id) returning id into v_meal_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_result->'items') loop
    insert into meal_items (user_id, meal_id, name, brand, quantity, calories, protein_g, carbs_g, fat_g, fiber_g, source_url, source_title, confidence, position)
    values (v_job.user_id, v_meal_id, btrim(v_item->>'name'), nullif(btrim(v_item->>'brand'), ''), btrim(v_item->>'quantity'),
      (v_item->>'calories')::numeric, (v_item->>'protein_g')::numeric, (v_item->>'carbs_g')::numeric, (v_item->>'fat_g')::numeric,
      nullif(v_item->>'fiber_g', '')::numeric, nullif(btrim(v_item->>'source_url'), ''), nullif(btrim(v_item->>'source_title'), ''),
      coalesce(nullif(v_item->>'confidence', ''), 'medium'), v_position);
    v_position := v_position + 1;
  end loop;
  update meal_research_jobs set status='succeeded', result_meal_id=v_meal_id, lease_expires_at=null, lock_token=null, completed_at=now(), updated_at=now() where id=v_job.id;
  return v_meal_id;
end $$;

create or replace function copy_meal_from_reusable(p_reusable_id uuid, p_logged_on date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := (select auth.uid()); v_template reusable_meals; v_meal_id uuid; v_item jsonb; v_position integer := 0;
begin
  select * into v_template from reusable_meals where id=p_reusable_id and user_id=v_uid for update;
  if v_template.id is null then raise exception 'saved meal not found'; end if;
  insert into meals (user_id, logged_on, meal_type, title, original_input, assumptions, nutrition_status, source_reusable_meal_id, source_reusable_meal_revision)
  values (v_uid, p_logged_on, v_template.meal_type, v_template.name, v_template.original_input, v_template.assumptions, v_template.nutrition_status, v_template.id, v_template.revision) returning id into v_meal_id;
  for v_item in select value from jsonb_array_elements(v_template.items) loop
    insert into meal_items (user_id, meal_id, name, brand, quantity, calories, protein_g, carbs_g, fat_g, fiber_g, source_url, source_title, confidence, position)
    values (v_uid, v_meal_id, btrim(v_item->>'name'), nullif(btrim(v_item->>'brand'), ''), btrim(v_item->>'quantity'), (v_item->>'calories')::numeric, (v_item->>'protein_g')::numeric, (v_item->>'carbs_g')::numeric, (v_item->>'fat_g')::numeric, nullif(v_item->>'fiber_g', '')::numeric, nullif(btrim(v_item->>'source_url'), ''), nullif(btrim(v_item->>'source_title'), ''), coalesce(nullif(v_item->>'confidence', ''), 'medium'), v_position);
    v_position := v_position + 1;
  end loop;
  update reusable_meals set last_used_at=now(), updated_at=updated_at where id=v_template.id;
  return v_meal_id;
end $$;

create or replace function save_reusable_meal_from_meal(p_meal_id uuid, p_name text)
returns reusable_meals language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := (select auth.uid()); v_meal meals; v_template reusable_meals;
begin
  select * into v_meal from meals where id=p_meal_id and user_id=v_uid;
  if v_meal.id is null then raise exception 'meal not found'; end if;
  insert into reusable_meals (user_id, name, meal_type, original_input, assumptions, items, nutrition_status, source_meal_id)
  select v_uid, btrim(p_name), v_meal.meal_type, v_meal.original_input, v_meal.assumptions,
    jsonb_agg(jsonb_build_object('name', i.name, 'brand', i.brand, 'quantity', i.quantity, 'calories', i.calories, 'protein_g', i.protein_g, 'carbs_g', i.carbs_g, 'fat_g', i.fat_g, 'fiber_g', i.fiber_g, 'source_url', i.source_url, 'source_title', i.source_title, 'confidence', i.confidence) order by i.position),
    v_meal.nutrition_status, v_meal.id from meal_items i where i.meal_id=v_meal.id group by v_meal.id
  on conflict (user_id, lower(btrim(name))) do update set meal_type=excluded.meal_type, original_input=excluded.original_input,
    assumptions=excluded.assumptions, items=excluded.items, nutrition_status=excluded.nutrition_status, source_meal_id=excluded.source_meal_id,
    revision=reusable_meals.revision+1, updated_at=now()
  returning * into v_template;
  return v_template;
end $$;

create or replace function copy_meal_from_history(p_source_meal_id uuid, p_logged_on date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := (select auth.uid()); v_source meals; v_meal_id uuid;
begin
  select * into v_source from meals where id=p_source_meal_id and user_id=v_uid;
  if v_source.id is null then raise exception 'meal not found'; end if;
  insert into meals (user_id, logged_on, meal_type, title, original_input, assumptions, nutrition_status, source_meal_id)
  values (v_uid, p_logged_on, v_source.meal_type, v_source.title, v_source.original_input, v_source.assumptions, v_source.nutrition_status, v_source.id) returning id into v_meal_id;
  insert into meal_items (user_id, meal_id, name, brand, quantity, calories, protein_g, carbs_g, fat_g, fiber_g, source_url, source_title, confidence, position)
  select v_uid, v_meal_id, name, brand, quantity, calories, protein_g, carbs_g, fat_g, fiber_g, source_url, source_title, confidence, position from meal_items where meal_id=v_source.id order by position;
  return v_meal_id;
end $$;

create or replace function discard_meal_research_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update meal_research_jobs set status='discarded', completed_at=now(), updated_at=now()
  where id=p_job_id and user_id=(select auth.uid()) and status='needs_review';
  if not found then raise exception 'meal research request cannot be discarded'; end if;
end $$;

create or replace function approve_meal_research_estimate(p_job_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job meal_research_jobs; v_meal_id uuid; v_item jsonb; v_position integer := 0;
begin
  select * into v_job from meal_research_jobs where id=p_job_id and user_id=(select auth.uid()) for update;
  if v_job.id is null or v_job.status <> 'needs_review' or jsonb_typeof(v_job.draft_analysis->'items') <> 'array' then raise exception 'no reviewable estimate is available'; end if;
  insert into meals (user_id, logged_on, meal_type, title, original_input, assumptions, nutrition_status, research_job_id)
  values (v_job.user_id, v_job.logged_on, v_job.draft_analysis->>'meal_type', btrim(v_job.draft_analysis->>'title'), v_job.original_input,
    coalesce(array(select jsonb_array_elements_text(v_job.draft_analysis->'assumptions')), '{}'), 'estimate', v_job.id) returning id into v_meal_id;
  for v_item in select value from jsonb_array_elements(v_job.draft_analysis->'items') loop
    insert into meal_items (user_id, meal_id, name, brand, quantity, calories, protein_g, carbs_g, fat_g, fiber_g, source_url, source_title, confidence, position)
    values (v_job.user_id, v_meal_id, btrim(v_item->>'name'), nullif(btrim(v_item->>'brand'), ''), btrim(v_item->>'quantity'), (v_item->>'calories')::numeric, (v_item->>'protein_g')::numeric, (v_item->>'carbs_g')::numeric, (v_item->>'fat_g')::numeric, nullif(v_item->>'fiber_g', '')::numeric, null, null, 'low', v_position);
    v_position := v_position + 1;
  end loop;
  update meal_research_jobs set status='succeeded', result_meal_id=v_meal_id, completed_at=now(), updated_at=now() where id=v_job.id;
  return v_meal_id;
end $$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoke it
-- explicitly before granting the small browser and worker surfaces below.
revoke all on function enqueue_meal_research(uuid, text, date, text, text, text, uuid),
  copy_meal_from_reusable(uuid, date), copy_meal_from_history(uuid, date),
  save_reusable_meal_from_meal(uuid, text), discard_meal_research_job(uuid),
  approve_meal_research_estimate(uuid), claim_due_meal_research_job(),
  resolve_meal_research_job(uuid, uuid, text, jsonb, text, text, integer),
  finalize_meal_research_job(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function enqueue_meal_research(uuid, text, date, text, text, text, uuid),
  copy_meal_from_reusable(uuid, date), copy_meal_from_history(uuid, date),
  save_reusable_meal_from_meal(uuid, text), discard_meal_research_job(uuid),
  approve_meal_research_estimate(uuid) to authenticated;
grant execute on function claim_due_meal_research_job(),
  resolve_meal_research_job(uuid, uuid, text, jsonb, text, text, integer),
  finalize_meal_research_job(uuid, uuid, jsonb) to service_role;

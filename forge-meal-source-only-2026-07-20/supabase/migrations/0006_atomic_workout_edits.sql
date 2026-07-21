-- Forge — atomic live-workout edits
-- Each operation updates today's session and its reusable routine template in
-- one transaction. Existing rows are untouched; these functions only govern
-- future add/swap/remove/reorder actions from the workout logger.

create or replace function add_session_exercise_and_routine(
  p_session_id uuid,
  p_exercise_id uuid,
  p_position integer,
  p_set_count integer default 3
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_routine_id uuid;
  v_session_exercise_id uuid;
  v_n integer;
  v_count integer := greatest(1, least(coalesce(p_set_count, 3), 20));
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select routine_id into v_routine_id
    from sessions where id = p_session_id and user_id = v_uid;
  if not found then raise exception 'session not found'; end if;
  if not exists (select 1 from exercises where id = p_exercise_id and user_id = v_uid) then
    raise exception 'exercise not found';
  end if;
  if exists (
    select 1 from session_exercises
     where session_id = p_session_id and exercise_id = p_exercise_id and user_id = v_uid
  ) then
    raise exception 'exercise already in session';
  end if;

  if v_routine_id is not null and not exists (
    select 1 from routine_exercises
     where routine_id = v_routine_id and exercise_id = p_exercise_id and user_id = v_uid
  ) then
    insert into routine_exercises (user_id, routine_id, exercise_id, position, target_sets)
    values (v_uid, v_routine_id, p_exercise_id, p_position, v_count);
  end if;

  insert into session_exercises (user_id, session_id, exercise_id, position)
  values (v_uid, p_session_id, p_exercise_id, p_position)
  returning id into v_session_exercise_id;

  for v_n in 1..v_count loop
    insert into sets (user_id, session_exercise_id, set_number)
    values (v_uid, v_session_exercise_id, v_n);
  end loop;

  return v_session_exercise_id;
end $$;

create or replace function swap_session_exercise_and_routine(
  p_session_exercise_id uuid,
  p_new_exercise_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old_exercise_id uuid;
  v_routine_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from exercises where id = p_new_exercise_id and user_id = v_uid) then
    raise exception 'exercise not found';
  end if;

  select se.exercise_id, s.routine_id into v_old_exercise_id, v_routine_id
    from session_exercises se
    join sessions s on s.id = se.session_id
   where se.id = p_session_exercise_id and se.user_id = v_uid and s.user_id = v_uid;
  if not found then raise exception 'session exercise not found'; end if;

  update session_exercises set exercise_id = p_new_exercise_id
   where id = p_session_exercise_id and user_id = v_uid;
  if v_routine_id is not null then
    update routine_exercises set exercise_id = p_new_exercise_id
     where routine_id = v_routine_id and exercise_id = v_old_exercise_id and user_id = v_uid;
  end if;
end $$;

create or replace function remove_session_exercise_and_routine(p_session_exercise_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_exercise_id uuid;
  v_routine_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select se.exercise_id, s.routine_id into v_exercise_id, v_routine_id
    from session_exercises se
    join sessions s on s.id = se.session_id
   where se.id = p_session_exercise_id and se.user_id = v_uid and s.user_id = v_uid;
  if not found then raise exception 'session exercise not found'; end if;

  delete from session_exercises where id = p_session_exercise_id and user_id = v_uid;
  if v_routine_id is not null then
    delete from routine_exercises
     where routine_id = v_routine_id and exercise_id = v_exercise_id and user_id = v_uid;
  end if;
end $$;

create or replace function reorder_session_exercises_and_routine(p_ordered_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session_id uuid;
  v_routine_id uuid;
  v_total integer;
  v_item record;
  v_exercise_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(cardinality(p_ordered_ids), 0) = 0 then raise exception 'order is required'; end if;

  select se.session_id, s.routine_id into v_session_id, v_routine_id
    from session_exercises se
    join sessions s on s.id = se.session_id
   where se.id = p_ordered_ids[1] and se.user_id = v_uid and s.user_id = v_uid;
  if not found then raise exception 'session not found'; end if;

  select count(*) into v_total from session_exercises
   where session_id = v_session_id and user_id = v_uid;
  if v_total <> cardinality(p_ordered_ids) or (
    select count(*) from session_exercises
     where session_id = v_session_id and user_id = v_uid and id = any(p_ordered_ids)
  ) <> cardinality(p_ordered_ids) then
    raise exception 'order must contain every session exercise exactly once';
  end if;

  for v_item in select id, ordinality from unnest(p_ordered_ids) with ordinality as x(id, ordinality)
  loop
    update session_exercises set position = v_item.ordinality - 1
     where id = v_item.id and user_id = v_uid
     returning exercise_id into v_exercise_id;
    if v_routine_id is not null then
      update routine_exercises set position = v_item.ordinality - 1
       where routine_id = v_routine_id and exercise_id = v_exercise_id and user_id = v_uid;
    end if;
  end loop;
end $$;

grant execute on function add_session_exercise_and_routine(uuid, uuid, integer, integer) to authenticated;
grant execute on function swap_session_exercise_and_routine(uuid, uuid) to authenticated;
grant execute on function remove_session_exercise_and_routine(uuid) to authenticated;
grant execute on function reorder_session_exercises_and_routine(uuid[]) to authenticated;

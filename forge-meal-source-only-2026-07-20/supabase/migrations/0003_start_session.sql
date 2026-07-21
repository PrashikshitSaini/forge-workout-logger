-- Forge — start_session
-- The "smart pre-fill" engine. Given a regime + routine + date:
--   • resume the existing session for that day if one exists, else
--   • create it and clone the most recent prior session of the same routine,
--     copying each set's numbers as editable placeholders (done = false).
-- Atomic, so a dropped connection mid-build never leaves a half-made session.

create or replace function start_session(
  p_regime_id   uuid,
  p_routine_id  uuid,
  p_performed_on date default current_date
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid             uuid := (select auth.uid());
  v_session_id      uuid;
  v_prefill_session uuid;
  v_re              record;
  v_new_se_id       uuid;
  v_prefill_se      uuid;
  v_set_count       integer;
  v_n               integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Resume an existing session for this routine on this date.
  select id into v_session_id
    from sessions
   where user_id = v_uid and routine_id = p_routine_id and performed_on = p_performed_on
   limit 1;
  if v_session_id is not null then
    return v_session_id;
  end if;

  insert into sessions (user_id, regime_id, routine_id, performed_on)
  values (v_uid, p_regime_id, p_routine_id, p_performed_on)
  returning id into v_session_id;

  -- Most recent prior session of this routine, used as the pre-fill source.
  select id into v_prefill_session
    from sessions
   where user_id = v_uid and routine_id = p_routine_id and id <> v_session_id
   order by performed_on desc, created_at desc
   limit 1;

  for v_re in
    select exercise_id, position, target_sets
      from routine_exercises
     where routine_id = p_routine_id
     order by position, created_at
  loop
    insert into session_exercises (user_id, session_id, exercise_id, position)
    values (v_uid, v_session_id, v_re.exercise_id, v_re.position)
    returning id into v_new_se_id;

    v_prefill_se := null;
    if v_prefill_session is not null then
      select id into v_prefill_se
        from session_exercises
       where session_id = v_prefill_session and exercise_id = v_re.exercise_id
       order by position
       limit 1;
    end if;

    if v_prefill_se is not null then
      insert into sets (user_id, session_exercise_id, set_number, weight, reps, rpe, duration_seconds, level, done)
      select v_uid, v_new_se_id, set_number, weight, reps, rpe, duration_seconds, level, false
        from sets
       where session_exercise_id = v_prefill_se
       order by set_number;
    else
      v_set_count := coalesce(v_re.target_sets, 3);
      for v_n in 1..v_set_count loop
        insert into sets (user_id, session_exercise_id, set_number)
        values (v_uid, v_new_se_id, v_n);
      end loop;
    end if;
  end loop;

  return v_session_id;
end $$;

grant execute on function start_session(uuid, uuid, date) to authenticated;

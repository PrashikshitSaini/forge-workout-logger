-- Forge — server-side functions
-- switch_regime: atomically archive the current active regime and start a new
-- one, optionally cloning the previous regime's day templates as a starting
-- point. Atomic so the "one active regime per user" index can never be violated
-- and we can never end up with zero active regimes mid-switch.

create or replace function switch_regime(
  p_name       text,
  p_clone_from uuid default null
)
returns regimes
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid           uuid := (select auth.uid());
  v_new           regimes;
  v_old_routine   routines;
  v_new_routine_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'regime name is required';
  end if;

  -- Archive the currently active regime (if any).
  update regimes
     set is_active = false,
         ended_on  = current_date
   where user_id = v_uid
     and is_active;

  -- Start the new active regime.
  insert into regimes (user_id, name, is_active)
  values (v_uid, btrim(p_name), true)
  returning * into v_new;

  -- Optionally clone routines + their exercises from a previous regime.
  if p_clone_from is not null then
    for v_old_routine in
      select * from routines
       where regime_id = p_clone_from
         and user_id = v_uid
       order by position, created_at
    loop
      insert into routines (user_id, regime_id, day_of_week, name, position)
      values (v_uid, v_new.id, v_old_routine.day_of_week, v_old_routine.name, v_old_routine.position)
      returning id into v_new_routine_id;

      insert into routine_exercises (user_id, routine_id, exercise_id, position, target_sets, target_reps)
      select v_uid, v_new_routine_id, exercise_id, position, target_sets, target_reps
        from routine_exercises
       where routine_id = v_old_routine.id;
    end loop;
  end if;

  return v_new;
end $$;

grant execute on function switch_regime(text, uuid) to authenticated;

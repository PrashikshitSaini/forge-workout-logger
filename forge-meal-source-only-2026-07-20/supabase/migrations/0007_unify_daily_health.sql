-- Forge — unify weight and wearable metrics in daily_health.
--
-- Existing body_stats rows are deliberately retained. This migration only
-- copies their useful values into the consolidated daily timeline, filling
-- gaps without overwriting anything already synced by MacroDroid.

alter table daily_health
  add column if not exists bodyweight numeric(6, 2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_health_bodyweight_check'
      and conrelid = 'daily_health'::regclass
  ) then
    alter table daily_health
      add constraint daily_health_bodyweight_check
      check (bodyweight is null or bodyweight between 0 and 1000);
  end if;
end $$;

insert into daily_health (
  user_id,
  recorded_on,
  bodyweight,
  sleep_minutes,
  resting_hr,
  source
)
select
  user_id,
  recorded_on,
  case
    when bodyweight between 0 and 1000 then bodyweight
    else null
  end,
  case
    when sleep_hours between 0 and 24 then round(sleep_hours * 60)::integer
    else null
  end,
  case
    when resting_hr between 0 and 250 then resting_hr
    else null
  end,
  'legacy_manual'
from body_stats
where bodyweight between 0 and 1000
   or sleep_hours between 0 and 24
   or resting_hr between 0 and 250
on conflict (user_id, recorded_on) do update
set
  bodyweight = coalesce(daily_health.bodyweight, excluded.bodyweight),
  sleep_minutes = coalesce(daily_health.sleep_minutes, excluded.sleep_minutes),
  resting_hr = coalesce(daily_health.resting_hr, excluded.resting_hr);

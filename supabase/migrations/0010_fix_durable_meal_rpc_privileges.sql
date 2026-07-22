-- Corrective migration for installations that already applied 0009.
-- User mutation RPCs need definer privileges because 0009 intentionally
-- revoked direct writes to the jobs and reusable-meals tables.

alter function enqueue_meal_research(uuid, text, date, text, text, text, uuid) security definer;
alter function copy_meal_from_reusable(uuid, date) security definer;
alter function copy_meal_from_history(uuid, date) security definer;
alter function save_reusable_meal_from_meal(uuid, text) security definer;
alter function discard_meal_research_job(uuid) security definer;
alter function approve_meal_research_estimate(uuid) security definer;

revoke all on table meal_research_jobs, reusable_meals from public, anon, authenticated;
grant select on meal_research_jobs, reusable_meals to authenticated;

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

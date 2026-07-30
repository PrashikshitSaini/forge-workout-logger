-- Forge now uses one synchronous meal-research action. Stop unfinished
-- background work before it can finalize and remove worker execution surfaces.
delete from meal_research_jobs
where status in ('queued', 'running', 'retry_wait');

revoke all on function claim_due_meal_research_job(),
  resolve_meal_research_job(uuid, uuid, text, jsonb, text, text, integer),
  finalize_meal_research_job(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

drop function if exists claim_due_meal_research_job();
drop function if exists resolve_meal_research_job(uuid, uuid, text, jsonb, text, text, integer);
drop function if exists finalize_meal_research_job(uuid, uuid, jsonb);

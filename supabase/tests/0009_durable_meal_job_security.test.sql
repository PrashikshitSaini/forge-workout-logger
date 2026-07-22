begin;
select plan(17);

-- The worker entry points must be unreachable from every browser-facing role.
select ok(not has_function_privilege('public', 'public.claim_due_meal_research_job()', 'EXECUTE'), 'PUBLIC cannot claim meal jobs');
select ok(not has_function_privilege('anon', 'public.claim_due_meal_research_job()', 'EXECUTE'), 'anon cannot claim meal jobs');
select ok(not has_function_privilege('authenticated', 'public.claim_due_meal_research_job()', 'EXECUTE'), 'authenticated cannot claim meal jobs');
select ok(not has_function_privilege('authenticated', 'public.resolve_meal_research_job(uuid,uuid,text,jsonb,text,text,integer)', 'EXECUTE'), 'authenticated cannot resolve meal jobs');
select ok(not has_function_privilege('authenticated', 'public.finalize_meal_research_job(uuid,uuid,jsonb)', 'EXECUTE'), 'authenticated cannot finalize meal jobs');
select ok(has_function_privilege('service_role', 'public.claim_due_meal_research_job()', 'EXECUTE'), 'service role can claim meal jobs');

-- Job state is RPC-owned, so an ordinary user cannot mutate its own or another
-- user’s job directly. The owner-only SELECT policy prevents cross-user reads.
select ok(not has_table_privilege('authenticated', 'public.meal_research_jobs', 'INSERT'), 'authenticated cannot insert jobs directly');
select ok(not has_table_privilege('authenticated', 'public.meal_research_jobs', 'UPDATE'), 'authenticated cannot update jobs directly');
select ok(not has_table_privilege('authenticated', 'public.meal_research_jobs', 'DELETE'), 'authenticated cannot delete jobs directly');
select policies_are('public', 'meal_research_jobs', array['meal_research_jobs_owner_read'], 'only the owner read policy exists');
select ok(has_function_privilege('authenticated', 'public.enqueue_meal_research(uuid,text,date,text,text,text,uuid)', 'EXECUTE'), 'authenticated may only enqueue through the owner-bound RPC');
select ok((select prosecdef from pg_proc where oid = 'public.enqueue_meal_research(uuid,text,date,text,text,text,uuid)'::regprocedure), 'enqueue is a privileged owner-bound RPC');
select ok((select prosecdef from pg_proc where oid = 'public.copy_meal_from_reusable(uuid,date)'::regprocedure), 'reusable copy is privileged');
select ok((select prosecdef from pg_proc where oid = 'public.copy_meal_from_history(uuid,date)'::regprocedure), 'history copy is privileged');
select ok((select prosecdef from pg_proc where oid = 'public.save_reusable_meal_from_meal(uuid,text)'::regprocedure), 'reusable save is privileged');
select ok((select prosecdef from pg_proc where oid = 'public.discard_meal_research_job(uuid)'::regprocedure), 'review discard is privileged');
select ok((select prosecdef from pg_proc where oid = 'public.approve_meal_research_estimate(uuid)'::regprocedure), 'estimate approval is privileged');

select * from finish();
rollback;

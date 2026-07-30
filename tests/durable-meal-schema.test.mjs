import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync(new URL("../supabase/migrations/0009_durable_meals_and_reuse.sql", import.meta.url), "utf8");
const analyzer = fs.readFileSync(new URL("../app/api/meals/analyze/route.ts", import.meta.url), "utf8");
const correctiveSql = fs.readFileSync(new URL("../supabase/migrations/0010_fix_durable_meal_rpc_privileges.sql", import.meta.url), "utf8");
const disableBackgroundSql = fs.readFileSync(new URL("../supabase/migrations/0011_disable_background_meal_research.sql", import.meta.url), "utf8");

test("durable schema has idempotency, leases, and exactly-once finalization guard", () => {
  assert.match(sql, /unique \(user_id, idempotency_key\)/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /meals_research_job_once_idx/);
  assert.match(sql, /lock_token is distinct from p_lock_token/i);
});

test("schema keeps reusable and historical copies separate", () => {
  assert.match(sql, /create table if not exists reusable_meals/i);
  assert.match(sql, /copy_meal_from_reusable/i);
  assert.match(sql, /copy_meal_from_history/i);
  assert.match(sql, /source_reusable_meal_revision/i);
});

test("needs-review paths retain draft estimates and allow explicit resolution", () => {
  assert.match(sql, /needs_review/);
  assert.match(sql, /approve_meal_research_estimate/);
  assert.match(sql, /discard_meal_research_job/);
});

test("worker RPCs revoke PostgreSQL's default PUBLIC execute privilege", () => {
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function claim_due_meal_research_job\(\)[\s\S]*to service_role/i);
});

test("approved user mutations are definer functions with owner checks", () => {
  for (const name of ["enqueue_meal_research", "copy_meal_from_reusable", "copy_meal_from_history", "save_reusable_meal_from_meal", "discard_meal_research_job", "approve_meal_research_estimate"]) {
    assert.match(sql, new RegExp(`create or replace function ${name}[\\s\\S]*?security definer`, "i"));
  }
  assert.match(sql, /where id=p_job_id and user_id=\(select auth\.uid\(\)\)/i);
  assert.match(sql, /where id=p_reusable_id and user_id=v_uid/i);
});

test("forward corrective migration fixes databases that already ran 0009", () => {
  assert.match(correctiveSql, /alter function enqueue_meal_research[\s\S]*security definer/i);
  assert.match(correctiveSql, /revoke all on function[\s\S]*from public, anon, authenticated, service_role/i);
});

test("single quick path lowers provider work without bypassing verification", () => {
  assert.doesNotMatch(analyzer, /body\.fast/);
  assert.match(analyzer, /maxResults: 3, maxTotalResults: 12, maxTokens: 1_800/);
  assert.match(analyzer, /engine: "auto"/);
  assert.doesNotMatch(analyzer, /tool_choice: "required"/);
  assert.match(analyzer, /scaleResearchedAnalysis\(analysis, extractCitations/);
});

test("meal research defaults to GPT-5.6 Luna", () => {
  assert.match(analyzer, /openai\/gpt-5\.6-luna/);
});

test("forward migration removes unfinished background research and worker functions", () => {
  assert.match(disableBackgroundSql, /delete from meal_research_jobs[\s\S]*queued', 'running', 'retry_wait/i);
  assert.match(disableBackgroundSql, /drop function if exists claim_due_meal_research_job/i);
});

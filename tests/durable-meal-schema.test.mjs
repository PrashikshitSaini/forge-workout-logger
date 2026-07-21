import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync(new URL("../supabase/migrations/0009_durable_meals_and_reuse.sql", import.meta.url), "utf8");

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

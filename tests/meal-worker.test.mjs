import assert from "node:assert/strict";
import test from "node:test";
import { finalizationPayload, researchJob } from "../lib/meal-worker.ts";
import { retryDelaySeconds } from "../lib/meal-jobs.ts";

const item = {
  name: "Black beans", brand: "Example", quantity: "1 cup", source_serving: "1/2 cup (130g)", consumed_amount: 1,
  consumed_unit: "cup", source_amount: 0.5, source_unit: "cup",
  label: { calories: 110, protein_g: 7, carbs_g: 20, fat_g: 0.5, fiber_g: 6 },
  source_url: "https://example.com/products/black-beans", source_title: "Beans facts",
  evidence: "Serving size 1/2 cup (130g). Calories 110. Total Fat 0.5g. Total Carbohydrate 20g. Protein 7g. Dietary Fiber 6g.", confidence: "high",
};
const job = { original_input: "one cup black beans", logged_on: "2026-07-21", attempt_count: 1, max_attempts: 6 };

test("provider timeout gets a bounded retry with fake provider", async () => {
  const outcome = await researchJob({ research: async () => { throw new Error("network timeout"); } }, job, () => 0.5);
  assert.equal(outcome.kind, "retry");
  assert.equal(outcome.delaySeconds, 15);
});

test("unverified nutrition becomes reviewable rather than a dead-end", async () => {
  const outcome = await researchJob({ research: async () => ({ analysis: { title: "Beans", meal_type: "meal", assumptions: [], items: [item] }, citations: [] }) }, job);
  assert.equal(outcome.kind, "review");
  assert.equal(outcome.code, "nutrition_unverified");
  assert.equal(outcome.draft.items[0].confidence, "low");
});

test("confirmed fake provider produces a finalization payload", async () => {
  const outcome = await researchJob({ research: async () => ({ analysis: { title: "Beans", meal_type: "meal", assumptions: [], items: [item] }, citations: [{ url: item.source_url, title: item.source_title, content: item.evidence }] }) }, job);
  assert.equal(outcome.kind, "finalize");
  const payload = finalizationPayload(outcome.analysis, outcome.items);
  assert.equal(payload.items[0].calories, 220);
});

test("retry backoff is capped and jittered", () => {
  assert.equal(retryDelaySeconds(1, () => 0.5), 15);
  assert.equal(retryDelaySeconds(99, () => 0.999), 1798);
});

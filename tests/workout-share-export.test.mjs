import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkoutShareCart, buildWorkoutShareFile } from "../lib/workout-share-export.ts";
import { parseWorkoutTemplate } from "../lib/workout-template-import.ts";
import { finishStaleSessions } from "../lib/session-lifecycle.ts";

test("share cart groups all historical exercises by performed weekday and removes duplicate names", () => {
  const cart = buildWorkoutShareCart([
    { position: 1, exercise: { id: "bench", name: "Incline dumbbell press" }, sessions: { performed_on: "2026-08-10" } },
    { position: 0, exercise: { id: "smith", name: "Smith machine press" }, sessions: { performed_on: "2026-08-10" } },
    { position: 0, exercise: { id: "old-bench", name: "Incline dumbbell press" }, sessions: { performed_on: "2026-08-03" } },
    { position: 0, exercise: { id: "row", name: "Cable row" }, sessions: { performed_on: "2026-08-11" } },
  ]);

  assert.deepEqual(cart[1], ["Smith machine press", "Incline dumbbell press"]);
  assert.deepEqual(cart[2], ["Cable row"]);
  assert.deepEqual(cart[0], []);
});

test("share file contains only selected days and ordered exercise names", () => {
  const cart = { 0: [], 1: ["Smith machine press", "Incline dumbbell press"], 2: ["Cable row"], 3: [], 4: [], 5: [], 6: [] };
  const file = buildWorkoutShareFile(cart, [1, 2]);
  assert.equal(file.format, "forge-workout-template-v1");
  assert.deepEqual(file.days, [
    { day: "Monday", exercises: ["Smith machine press", "Incline dumbbell press"] },
    { day: "Tuesday", exercises: ["Cable row"] },
  ]);
});

test("shared workout template is parsed with weekday and exercise order intact", () => {
  assert.deepEqual(parseWorkoutTemplate({
    format: "forge-workout-template-v1",
    exported_at: "2026-08-16T00:00:00.000Z",
    days: [{ day: "Monday", exercises: ["Smith machine press", "Cable fly"] }],
  }), {
    days: [{ day: 1, label: "Monday", exercises: ["Smith machine press", "Cable fly"] }],
  });
});

test("shared workout template rejects a repeated day", () => {
  assert.throws(() => parseWorkoutTemplate({
    format: "forge-workout-template-v1",
    days: [
      { day: "Monday", exercises: ["Smith machine press"] },
      { day: "Monday", exercises: ["Cable fly"] },
    ],
  }), /repeated day/);
});

test("v2 workout template parses regimen, routines, metadata, and targets", () => {
  assert.deepEqual(parseWorkoutTemplate({
    format: "forge-workout-template-v2",
    name: "Cut",
    notes: "Keep it moving.",
    days: [{
      day: "Monday",
      routine: "Upper A",
      exercises: [{ name: "Bench", type: "strength", muscle_group: "Chest", equipment: "Barbell", target_sets: 3, target_reps: "5-8 @ 1-2 RIR" }],
    }],
  }), {
    format: "forge-workout-template-v2",
    name: "Cut",
    notes: "Keep it moving.",
    days: [{
      day: 1,
      label: "Monday",
      routine: "Upper A",
      exercises: [{ name: "Bench", type: "strength", muscle_group: "Chest", equipment: "Barbell", target_sets: 3, target_reps: "5-8 @ 1-2 RIR" }],
    }],
  });
});

test("v2 workout template rejects invalid targets, types, and duplicate exercises", () => {
  const base = { format: "forge-workout-template-v2", name: "Cut", days: [{ day: "Monday", routine: "Upper A", exercises: [{ name: "Bench" }] }] };
  assert.throws(() => parseWorkoutTemplate({ ...base, days: [{ ...base.days[0], exercises: [{ name: "Bench", target_sets: 21 }] }] }), /Target sets/);
  assert.throws(() => parseWorkoutTemplate({ ...base, days: [{ ...base.days[0], exercises: [{ name: "Bench", type: "other" }] }] }), /exercise type/);
  assert.throws(() => parseWorkoutTemplate({ ...base, days: [{ ...base.days[0], exercises: [{ name: "Bench" }, { name: " bench " }] }] }), /twice/);
});

test("stale-session cleanup uses a 24-hour cutoff and explicit user scope", async () => {
  const calls = [];
  const query = {
    update(value) { calls.push(["update", value]); return query; },
    eq(column, value) { calls.push(["eq", column, value]); return query; },
    is(column, value) { calls.push(["is", column, value]); return query; },
    lte(column, value) { calls.push(["lte", column, value]); return Promise.resolve({ error: null }); },
  };
  await finishStaleSessions({ from: () => query }, "owner-1", new Date("2026-09-20T12:00:00.000Z"));
  assert.deepEqual(calls, [
    ["update", { finished_at: "2026-09-20T12:00:00.000Z" }],
    ["eq", "user_id", "owner-1"],
    ["is", "finished_at", null],
    ["lte", "created_at", "2026-09-19T12:00:00.000Z"],
  ]);
});

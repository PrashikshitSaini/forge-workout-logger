import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkoutExport } from "../lib/workout-export.ts";

const bench = { id: "bench", name: "Bench press", muscle_group: "chest", equipment: "barbell", type: "strength" };

test("workout export preserves all sets and derives completed-set trends only", () => {
  const result = buildWorkoutExport([
    {
      id: "workout-1", performed_on: "2026-08-01", notes: null, finished_at: "2026-08-01T12:00:00Z", created_at: "2026-08-01T10:00:00Z",
      regime: { id: "regime-1", name: "Strength", started_on: "2026-07-01", ended_on: null }, routine: null,
      session_exercises: [{ id: "session-exercise-1", position: 0, notes: null, created_at: "2026-08-01T10:00:00Z", exercise: bench, sets: [
        { id: "set-2", set_number: 2, weight: 100, reps: 5, rpe: 8, duration_seconds: null, level: null, done: true, created_at: "2026-08-01T10:01:00Z" },
        { id: "set-1", set_number: 1, weight: 95, reps: 5, rpe: null, duration_seconds: null, level: null, done: false, created_at: "2026-08-01T10:00:00Z" },
      ] }],
    },
  ], { from: null, to: null }, "2026-08-05T00:00:00.000Z");

  assert.equal(result.summary.workouts, 1);
  assert.equal(result.summary.sets, 2);
  assert.equal(result.summary.completed_sets, 1);
  assert.equal(result.summary.strength_volume, 500);
  assert.deepEqual(result.workouts[0].session_exercises[0].sets.map((entry) => entry.set_number), [1, 2]);
  assert.equal(result.exercise_trends[0].entries[0].best_weight, 100);
  assert.equal(result.exercise_trends[0].entries[0].estimated_one_rep_max, 117);
});

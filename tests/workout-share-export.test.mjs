import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkoutShareCart, buildWorkoutShareFile } from "../lib/workout-share-export.ts";

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

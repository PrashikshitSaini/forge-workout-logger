import assert from "node:assert/strict";
import test from "node:test";
import { findSimilarMeal } from "../lib/meal-duplicates.ts";

const chickenBowl = {
  id: "meal-1",
  title: "Chicken rice bowl",
  original_input: "I made a chicken rice bowl with black beans and salsa",
};

test("suggests an existing meal only when a new meal closely resembles it", () => {
  assert.equal(
    findSimilarMeal("Chicken rice bowl", "chicken rice bowl with black beans and salsa", [chickenBowl]),
    chickenBowl,
  );
});

test("does not treat a single shared ingredient as a duplicate", () => {
  assert.equal(
    findSimilarMeal("Chicken salad", "chicken salad with greens and vinaigrette", [chickenBowl]),
    null,
  );
});

test("does not suggest a duplicate for unrelated meals", () => {
  assert.equal(
    findSimilarMeal("Greek yogurt parfait", "Greek yogurt with berries and granola", [chickenBowl]),
    null,
  );
});

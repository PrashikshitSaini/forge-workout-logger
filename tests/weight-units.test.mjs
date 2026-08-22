import assert from "node:assert/strict";
import test from "node:test";
import { displayWeight, storedWeight } from "../lib/weight-units.ts";

test("weight display converts stored pounds to kilograms without changing pounds", () => {
  assert.equal(displayWeight(100, "lb"), 100);
  assert.equal(displayWeight(100, "kg"), 45.36);
});

test("kilogram input converts back to the canonical stored pounds value", () => {
  assert.equal(storedWeight(45.36, "kg"), 100);
  assert.equal(storedWeight(100, "lb"), 100);
});

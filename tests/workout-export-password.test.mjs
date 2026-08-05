import assert from "node:assert/strict";
import test from "node:test";
import { hashWorkoutExportPassword, verifyWorkoutExportPassword } from "../lib/workout-export-password.ts";

test("workout export passwords are salted and verify only the matching password", async () => {
  const first = await hashWorkoutExportPassword("a long personal export password");
  const second = await hashWorkoutExportPassword("a long personal export password");
  assert.notEqual(first, second);
  assert.equal(await verifyWorkoutExportPassword("a long personal export password", first), true);
  assert.equal(await verifyWorkoutExportPassword("wrong password", first), false);
});

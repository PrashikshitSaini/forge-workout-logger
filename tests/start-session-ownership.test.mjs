import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync(
  new URL("../supabase/migrations/0013_validate_start_session_ownership.sql", import.meta.url),
  "utf8",
);

test("start_session validates caller ownership before creating or resuming a session", () => {
  const regimeCheck = sql.indexOf("from regimes where id = p_regime_id and user_id = v_uid");
  const routineCheck = sql.indexOf("where id = p_routine_id and regime_id = p_regime_id and user_id = v_uid");
  const sessionLookup = sql.indexOf("from sessions\n   where user_id = v_uid and routine_id = p_routine_id");

  assert.ok(regimeCheck >= 0, "the regime must belong to the caller");
  assert.ok(routineCheck >= 0, "the routine must belong to the caller and supplied regime");
  assert.ok(sessionLookup > routineCheck, "ownership checks must run before the resume-or-create path");
});

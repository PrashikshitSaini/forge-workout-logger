import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BodyStat,
  DailyHealth,
  Exercise,
  ExerciseType,
  Regime,
  Routine,
  RoutineExercise,
  SessionExercise,
  WorkoutSet,
} from "./types";

/** All writes go through here. RLS + the auth.uid() column default keep them safe. */

/* ── Sessions / sets ─────────────────────────────────────────────────────── */

export async function startSession(
  sb: SupabaseClient,
  regimeId: string,
  routineId: string,
  performedOn?: string,
): Promise<string> {
  const { data, error } = await sb.rpc("start_session", {
    p_regime_id: regimeId,
    p_routine_id: routineId,
    ...(performedOn ? { p_performed_on: performedOn } : {}),
  });
  if (error) throw error;
  return data as string;
}

export type SetPatch = Partial<
  Pick<WorkoutSet, "weight" | "reps" | "rpe" | "duration_seconds" | "level" | "done" | "set_number">
>;

export async function updateSet(
  sb: SupabaseClient,
  setId: string,
  patch: SetPatch,
): Promise<void> {
  const { error } = await sb.from("sets").update(patch).eq("id", setId);
  if (error) throw error;
}

export async function addSet(
  sb: SupabaseClient,
  sessionExerciseId: string,
  setNumber: number,
  seed: SetPatch = {},
): Promise<WorkoutSet> {
  const { data, error } = await sb
    .from("sets")
    .insert({ session_exercise_id: sessionExerciseId, set_number: setNumber, done: false, ...seed })
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkoutSet;
}

export async function deleteSet(sb: SupabaseClient, setId: string): Promise<void> {
  const { error } = await sb.from("sets").delete().eq("id", setId);
  if (error) throw error;
}

export async function finishSession(sb: SupabaseClient, sessionId: string): Promise<void> {
  const { error } = await sb
    .from("sessions")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function updateSessionNotes(
  sb: SupabaseClient,
  sessionId: string,
  notes: string,
): Promise<void> {
  const { error } = await sb.from("sessions").update({ notes }).eq("id", sessionId);
  if (error) throw error;
}

export async function updateSessionExerciseNotes(
  sb: SupabaseClient,
  sessionExerciseId: string,
  notes: string,
): Promise<void> {
  const { error } = await sb
    .from("session_exercises")
    .update({ notes })
    .eq("id", sessionExerciseId);
  if (error) throw error;
}

/** Add an exercise to an in-progress session, with `setCount` empty sets. */
export async function addSessionExercise(
  sb: SupabaseClient,
  sessionId: string,
  exerciseId: string,
  position: number,
  setCount = 3,
): Promise<{ sessionExercise: SessionExercise; sets: WorkoutSet[] }> {
  const { data: seData, error } = await sb
    .from("session_exercises")
    .insert({ session_id: sessionId, exercise_id: exerciseId, position })
    .select("*")
    .single();
  if (error) throw error;
  const sessionExercise = seData as SessionExercise;

  const rows = Array.from({ length: Math.max(1, setCount) }, (_, i) => ({
    session_exercise_id: sessionExercise.id,
    set_number: i + 1,
  }));
  const { data: setsData, error: setErr } = await sb.from("sets").insert(rows).select("*");
  if (setErr) throw setErr;

  return { sessionExercise, sets: (setsData ?? []) as WorkoutSet[] };
}

/** Remove an exercise from a session. The FK cascade deletes its sets too. */
export async function deleteSessionExercise(
  sb: SupabaseClient,
  sessionExerciseId: string,
): Promise<void> {
  const { error } = await sb.from("session_exercises").delete().eq("id", sessionExerciseId);
  if (error) throw error;
}

/**
 * Replace the exercise on a session row, keeping its logged sets intact — they
 * reference the session_exercise row, not the exercise, so swapping (e.g.
 * "Incline Bench Press" → "Incline Bench Press Machine") preserves everything
 * already entered for it.
 */
export async function swapSessionExercise(
  sb: SupabaseClient,
  sessionExerciseId: string,
  newExerciseId: string,
): Promise<void> {
  const { error } = await sb
    .from("session_exercises")
    .update({ exercise_id: newExerciseId })
    .eq("id", sessionExerciseId);
  if (error) throw error;
}

/** Persist a new order for a session's exercises (position = array index). */
export async function reorderSessionExercises(
  sb: SupabaseClient,
  orderedIds: string[],
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, position) =>
      sb.from("session_exercises").update({ position }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/* ── Regimes ─────────────────────────────────────────────────────────────── */

/** First-run only: create the very first active regime (none exists yet). */
export async function createInitialRegime(
  sb: SupabaseClient,
  name: string,
): Promise<Regime> {
  const { data, error } = await sb
    .from("regimes")
    .insert({ name, is_active: true })
    .select("*")
    .single();
  if (error) throw error;
  return data as Regime;
}

/** Atomic switch: archive current active regime, start a new one (RPC). */
export async function switchRegime(
  sb: SupabaseClient,
  name: string,
  cloneFromRegimeId?: string,
): Promise<Regime> {
  const { data, error } = await sb.rpc("switch_regime", {
    p_name: name,
    p_clone_from: cloneFromRegimeId ?? null,
  });
  if (error) throw error;
  return data as Regime;
}

/* ── Routines ────────────────────────────────────────────────────────────── */

export async function createRoutine(
  sb: SupabaseClient,
  regimeId: string,
  name: string,
  dayOfWeek: number | null,
  position = 0,
): Promise<Routine> {
  const { data, error } = await sb
    .from("routines")
    .insert({ regime_id: regimeId, name, day_of_week: dayOfWeek, position })
    .select("*")
    .single();
  if (error) throw error;
  return data as Routine;
}

export async function updateRoutine(
  sb: SupabaseClient,
  routineId: string,
  patch: Partial<Pick<Routine, "name" | "day_of_week" | "position">>,
): Promise<void> {
  const { error } = await sb.from("routines").update(patch).eq("id", routineId);
  if (error) throw error;
}

export async function deleteRoutine(sb: SupabaseClient, routineId: string): Promise<void> {
  const { error } = await sb.from("routines").delete().eq("id", routineId);
  if (error) throw error;
}

export async function addRoutineExercise(
  sb: SupabaseClient,
  routineId: string,
  exerciseId: string,
  position: number,
  targetSets?: number | null,
  targetReps?: string | null,
): Promise<RoutineExercise> {
  const { data, error } = await sb
    .from("routine_exercises")
    .insert({
      routine_id: routineId,
      exercise_id: exerciseId,
      position,
      target_sets: targetSets ?? null,
      target_reps: targetReps ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as RoutineExercise;
}

/** Add an exercise to a routine template only if it isn't already there. */
export async function ensureRoutineExercise(
  sb: SupabaseClient,
  routineId: string,
  exerciseId: string,
  position: number,
  targetSets = 3,
): Promise<void> {
  const { data: existing, error } = await sb
    .from("routine_exercises")
    .select("id")
    .eq("routine_id", routineId)
    .eq("exercise_id", exerciseId)
    .maybeSingle();
  if (error) throw error;
  if (existing) return;
  await addRoutineExercise(sb, routineId, exerciseId, position, targetSets, null);
}

export async function updateRoutineExercise(
  sb: SupabaseClient,
  id: string,
  patch: Partial<Pick<RoutineExercise, "position" | "target_sets" | "target_reps">>,
): Promise<void> {
  const { error } = await sb.from("routine_exercises").update(patch).eq("id", id);
  if (error) throw error;
}

export async function removeRoutineExercise(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("routine_exercises").delete().eq("id", id);
  if (error) throw error;
}

/** Replace the exercise on a routine row by its id (used by the Routines editor). */
export async function swapRoutineExercise(
  sb: SupabaseClient,
  routineExerciseId: string,
  newExerciseId: string,
): Promise<void> {
  const { error } = await sb
    .from("routine_exercises")
    .update({ exercise_id: newExerciseId })
    .eq("id", routineExerciseId);
  if (error) throw error;
}

/* ── Routine write-through (keep a day's template in sync with live edits) ──
 * A session starts as a 1:1 copy of its routine, and every in-workout edit is
 * mirrored back here, so the routine can be matched by exercise_id. Each helper
 * is a safe no-op when the routine doesn't carry that exercise (e.g. it was
 * added ad-hoc after the session began, or the session had no routine).
 */

/** Swap an exercise in a routine template, matched by its current exercise. */
export async function swapRoutineExerciseByExercise(
  sb: SupabaseClient,
  routineId: string,
  fromExerciseId: string,
  toExerciseId: string,
): Promise<void> {
  if (fromExerciseId === toExerciseId) return;
  const { error } = await sb
    .from("routine_exercises")
    .update({ exercise_id: toExerciseId })
    .eq("routine_id", routineId)
    .eq("exercise_id", fromExerciseId);
  if (error) throw error;
}

/** Remove an exercise from a routine template, matched by exercise. */
export async function removeRoutineExerciseByExercise(
  sb: SupabaseClient,
  routineId: string,
  exerciseId: string,
): Promise<void> {
  const { error } = await sb
    .from("routine_exercises")
    .delete()
    .eq("routine_id", routineId)
    .eq("exercise_id", exerciseId);
  if (error) throw error;
}

/** Re-position routine exercises to mirror a session's order, matched by exercise. */
export async function reorderRoutineExercisesByExercise(
  sb: SupabaseClient,
  routineId: string,
  orderedExerciseIds: string[],
): Promise<void> {
  const results = await Promise.all(
    orderedExerciseIds.map((exerciseId, position) =>
      sb
        .from("routine_exercises")
        .update({ position })
        .eq("routine_id", routineId)
        .eq("exercise_id", exerciseId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/* ── Exercises ───────────────────────────────────────────────────────────── */

export async function createExercise(
  sb: SupabaseClient,
  input: { name: string; muscle_group?: string | null; equipment?: string | null; type?: ExerciseType },
): Promise<Exercise> {
  const { data, error } = await sb
    .from("exercises")
    .insert({
      name: input.name.trim(),
      muscle_group: input.muscle_group ?? null,
      equipment: input.equipment ?? null,
      type: input.type ?? "strength",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Exercise;
}

/** Find an exercise by name (case-insensitive) or create it. Avoids duplicates. */
export async function findOrCreateExercise(
  sb: SupabaseClient,
  input: { name: string; muscle_group?: string | null; equipment?: string | null; type?: ExerciseType },
): Promise<Exercise> {
  const name = input.name.trim();
  const { data: existing, error: findErr } = await sb
    .from("exercises")
    .select("*")
    .ilike("name", name)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing as Exercise;
  return createExercise(sb, { ...input, name });
}

/* ── Body stats ──────────────────────────────────────────────────────────── */

export async function upsertBodyStat(
  sb: SupabaseClient,
  input: {
    recorded_on: string;
    bodyweight?: number | null;
    body_fat?: number | null;
    sleep_hours?: number | null;
    resting_hr?: number | null;
    notes?: string | null;
  },
): Promise<BodyStat> {
  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser();
  if (userErr) throw userErr;
  if (!user) throw new Error("Not signed in.");

  const { data, error } = await sb
    .from("body_stats")
    .upsert({ ...input, user_id: user.id }, { onConflict: "user_id,recorded_on" })
    .select("*")
    .single();
  if (error) throw error;
  return data as BodyStat;
}

/* ── Daily health (watch sync) ───────────────────────────────────────────── */

/** The metric fields a sync can carry, keyed by recorded_on. */
export interface DailyHealthInput {
  recorded_on: string;
  steps?: number | null;
  active_kcal?: number | null;
  total_kcal?: number | null;
  distance_m?: number | null;
  sleep_minutes?: number | null;
  resting_hr?: number | null;
  avg_hr?: number | null;
  source?: string;
}

const DAILY_HEALTH_METRICS = [
  "steps",
  "active_kcal",
  "total_kcal",
  "distance_m",
  "sleep_minutes",
  "resting_hr",
  "avg_hr",
] as const;

/**
 * Merge-upsert one day's synced metrics, keyed on (user_id, recorded_on).
 *
 * `user_id` is passed explicitly because this runs from a token-authenticated
 * endpoint using the service-role client — there is no auth session to read it
 * from. Merge semantics: only the metrics actually provided (non-null) are
 * written; omitted or null fields preserve whatever was synced before, so a
 * partial sync can never wipe good data already on the row.
 */
export async function upsertDailyHealth(
  sb: SupabaseClient,
  userId: string,
  input: DailyHealthInput,
): Promise<DailyHealth> {
  const { data: existing, error: readErr } = await sb
    .from("daily_health")
    .select("*")
    .eq("user_id", userId)
    .eq("recorded_on", input.recorded_on)
    .maybeSingle();
  if (readErr) throw readErr;
  const base = existing as DailyHealth | null;

  const merged: Record<string, number | null> = {};
  for (const key of DAILY_HEALTH_METRICS) {
    // `??` only falls through on null/undefined, so a real 0 is preserved.
    merged[key] = input[key] ?? base?.[key] ?? null;
  }

  const { data, error } = await sb
    .from("daily_health")
    .upsert(
      {
        user_id: userId,
        recorded_on: input.recorded_on,
        ...merged,
        source: input.source ?? base?.source ?? "health_connect",
        synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,recorded_on" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as DailyHealth;
}

/**
 * Replace-upsert one day's metrics from a signed-in user editing by hand.
 *
 * Unlike upsertDailyHealth (merge, used by the sync endpoint), this writes the
 * provided values verbatim — a null clears that field — so the edit form is the
 * source of truth for the row. user_id comes from the auth session + RLS.
 */
export async function setDailyHealth(
  sb: SupabaseClient,
  input: DailyHealthInput,
): Promise<DailyHealth> {
  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser();
  if (userErr) throw userErr;
  if (!user) throw new Error("Not signed in.");

  const { data, error } = await sb
    .from("daily_health")
    .upsert(
      {
        user_id: user.id,
        recorded_on: input.recorded_on,
        steps: input.steps ?? null,
        active_kcal: input.active_kcal ?? null,
        total_kcal: input.total_kcal ?? null,
        distance_m: input.distance_m ?? null,
        sleep_minutes: input.sleep_minutes ?? null,
        resting_hr: input.resting_hr ?? null,
        avg_hr: input.avg_hr ?? null,
        source: input.source ?? "manual",
        synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,recorded_on" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as DailyHealth;
}

/** Delete one day's watch row. RLS scopes the delete to the signed-in user. */
export async function deleteDailyHealth(sb: SupabaseClient, recordedOn: string): Promise<void> {
  const { error } = await sb.from("daily_health").delete().eq("recorded_on", recordedOn);
  if (error) throw error;
}

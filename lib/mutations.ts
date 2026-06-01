import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BodyStat,
  Exercise,
  ExerciseType,
  Regime,
  Routine,
  RoutineExercise,
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

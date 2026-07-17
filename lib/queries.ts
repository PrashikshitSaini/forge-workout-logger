import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BodyStat,
  DailyHealth,
  Exercise,
  MealWithItems,
  NoteHistoryEntry,
  Regime,
  RoutineWithExercises,
  Session,
  SessionFull,
  WorkoutSet,
} from "./types";

/** All reads go through here. Nested arrays are sorted in JS for reliability. */

export async function getActiveRegime(sb: SupabaseClient): Promise<Regime | null> {
  const { data, error } = await sb
    .from("regimes")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as Regime | null) ?? null;
}

export async function getRegimes(sb: SupabaseClient): Promise<Regime[]> {
  const { data, error } = await sb
    .from("regimes")
    .select("*")
    .order("started_on", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<Regime[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getExercises(sb: SupabaseClient): Promise<Exercise[]> {
  const { data, error } = await sb
    .from("exercises")
    .select("*")
    .order("name", { ascending: true })
    .returns<Exercise[]>();
  if (error) throw error;
  return data ?? [];
}

const ROUTINE_SELECT = "*, routine_exercises(*, exercise:exercises(*))";

function sortRoutine(r: RoutineWithExercises): RoutineWithExercises {
  r.routine_exercises.sort((a, b) => a.position - b.position);
  return r;
}

export async function getRoutinesWithExercises(
  sb: SupabaseClient,
  regimeId: string,
): Promise<RoutineWithExercises[]> {
  const { data, error } = await sb
    .from("routines")
    .select(ROUTINE_SELECT)
    .eq("regime_id", regimeId)
    .order("position", { ascending: true })
    .returns<RoutineWithExercises[]>();
  if (error) throw error;
  return (data ?? []).map(sortRoutine);
}

export async function getRoutineForDay(
  sb: SupabaseClient,
  regimeId: string,
  dayOfWeek: number,
): Promise<RoutineWithExercises | null> {
  const { data, error } = await sb
    .from("routines")
    .select(ROUTINE_SELECT)
    .eq("regime_id", regimeId)
    .eq("day_of_week", dayOfWeek)
    .order("position", { ascending: true })
    .returns<RoutineWithExercises[]>();
  if (error) throw error;
  const first = data?.[0];
  return first ? sortRoutine(first) : null;
}

const SESSION_SELECT =
  "*, routine:routines(*), session_exercises(*, exercise:exercises(*), sets(*))";

export async function getSessionFull(
  sb: SupabaseClient,
  sessionId: string,
): Promise<SessionFull | null> {
  const { data, error } = await sb
    .from("sessions")
    .select(SESSION_SELECT)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const full = data as SessionFull;
  full.session_exercises.sort((a, b) => a.position - b.position);
  for (const se of full.session_exercises) {
    se.sets.sort((a, b) => a.set_number - b.set_number);
  }
  return full;
}

/** The session for a routine on a specific date, if one was already started. */
export async function getSessionIdForDate(
  sb: SupabaseClient,
  routineId: string,
  performedOn: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("sessions")
    .select("id")
    .eq("routine_id", routineId)
    .eq("performed_on", performedOn)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/** Most recent finished/prior session of a routine — used for preview reference. */
export async function getLastSessionForRoutine(
  sb: SupabaseClient,
  routineId: string,
  excludeDate?: string,
): Promise<SessionFull | null> {
  let q = sb
    .from("sessions")
    .select("id")
    .eq("routine_id", routineId)
    .order("performed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (excludeDate) q = q.neq("performed_on", excludeDate);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  const row = data as { id: string } | null;
  if (!row?.id) return null;
  return getSessionFull(sb, row.id);
}

/** Recent sessions (most recent first), optionally limited. */
export async function getRecentSessions(
  sb: SupabaseClient,
  limit = 30,
): Promise<Session[]> {
  const { data, error } = await sb
    .from("sessions")
    .select("*")
    .order("performed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Session[]>();
  if (error) throw error;
  return data ?? [];
}

/** Every logged set for one exercise across all regimes, with its session date. */
export interface ExerciseSetPoint {
  performed_on: string;
  weight: number | null;
  reps: number | null;
  duration_seconds: number | null;
  level: number | null;
}

export async function getExerciseHistory(
  sb: SupabaseClient,
  exerciseId: string,
): Promise<ExerciseSetPoint[]> {
  // sets → session_exercises (filter exercise) → sessions (date)
  const { data, error } = await sb
    .from("sets")
    .select(
      "weight, reps, duration_seconds, level, done, session_exercises!inner(exercise_id, sessions!inner(performed_on))",
    )
    .eq("session_exercises.exercise_id", exerciseId)
    .returns<
      {
        weight: number | null;
        reps: number | null;
        duration_seconds: number | null;
        level: number | null;
        done: boolean;
        session_exercises: { sessions: { performed_on: string } };
      }[]
    >();
  if (error) throw error;
  return (data ?? [])
    .map((row) => ({
      performed_on: row.session_exercises.sessions.performed_on,
      weight: row.weight,
      reps: row.reps,
      duration_seconds: row.duration_seconds,
      level: row.level,
    }))
    .sort((a, b) => a.performed_on.localeCompare(b.performed_on));
}

export async function getBodyStats(
  sb: SupabaseClient,
  limit = 90,
): Promise<BodyStat[]> {
  const { data, error } = await sb
    .from("body_stats")
    .select("*")
    .order("recorded_on", { ascending: false })
    .limit(limit)
    .returns<BodyStat[]>();
  if (error) throw error;
  return data ?? [];
}

/** Watch-synced daily metrics (most recent first). See lib/types DailyHealth. */
export async function getDailyHealth(
  sb: SupabaseClient,
  limit = 90,
): Promise<DailyHealth[]> {
  const { data, error } = await sb
    .from("daily_health")
    .select("*")
    .order("recorded_on", { ascending: false })
    .limit(limit)
    .returns<DailyHealth[]>();
  if (error) throw error;
  return data ?? [];
}

/** Recent conversational meal entries with their researched items. */
export async function getMeals(
  sb: SupabaseClient,
  limit = 100,
): Promise<MealWithItems[]> {
  const { data, error } = await sb
    .from("meals")
    .select("*, meal_items(*)")
    .order("logged_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<MealWithItems[]>();
  if (error) throw error;
  return (data ?? []).map((meal) => ({
    ...meal,
    meal_items: [...meal.meal_items].sort((a, b) => a.position - b.position),
  }));
}

/** Dated notes previously recorded for one exercise, newest first. */
export async function getExerciseNoteHistory(
  sb: SupabaseClient,
  exerciseId: string,
  excludeSessionId?: string,
  limit = 30,
): Promise<NoteHistoryEntry[]> {
  const { data, error } = await sb
    .from("session_exercises")
    .select("id, notes, sessions!inner(id, performed_on)")
    .eq("exercise_id", exerciseId)
    .not("notes", "is", null)
    .neq("notes", "")
    .returns<
      { id: string; notes: string | null; sessions: { id: string; performed_on: string } }[]
    >();
  if (error) throw error;
  return (data ?? [])
    .filter(
      (row) =>
        row.sessions.id !== excludeSessionId && Boolean(row.notes?.trim()),
    )
    .map((row) => ({
      id: row.id,
      performed_on: row.sessions.performed_on,
      notes: row.notes!.trim(),
    }))
    .sort((a, b) => b.performed_on.localeCompare(a.performed_on))
    .slice(0, limit);
}

/** Dated whole-workout notes from earlier sessions of this routine. */
export async function getWorkoutNoteHistory(
  sb: SupabaseClient,
  routineId: string,
  excludeSessionId?: string,
  limit = 30,
): Promise<NoteHistoryEntry[]> {
  let query = sb
    .from("sessions")
    .select("id, performed_on, notes")
    .eq("routine_id", routineId)
    .not("notes", "is", null)
    .neq("notes", "")
    .order("performed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (excludeSessionId) query = query.neq("id", excludeSessionId);
  const { data, error } = await query.returns<
    { id: string; performed_on: string; notes: string | null }[]
  >();
  if (error) throw error;
  return (data ?? [])
    .filter((row) => Boolean(row.notes?.trim()))
    .slice(0, limit)
    .map((row) => ({ id: row.id, performed_on: row.performed_on, notes: row.notes!.trim() }));
}

/** All sets for a date range, joined to exercise + session, for reports. */
export interface ReportSetRow {
  performed_on: string;
  weight: number | null;
  reps: number | null;
  duration_seconds: number | null;
  done: boolean;
  muscle_group: string | null;
  exercise_id: string;
  exercise_name: string;
  exercise_type: string;
}

export async function getSetsSince(
  sb: SupabaseClient,
  sinceISODate: string,
): Promise<ReportSetRow[]> {
  const { data, error } = await sb
    .from("sets")
    .select(
      "weight, reps, duration_seconds, done, session_exercises!inner(exercise:exercises!inner(id, name, muscle_group, type), sessions!inner(performed_on))",
    )
    .gte("session_exercises.sessions.performed_on", sinceISODate)
    .returns<
      {
        weight: number | null;
        reps: number | null;
        duration_seconds: number | null;
        done: boolean;
        session_exercises: {
          exercise: { id: string; name: string; muscle_group: string | null; type: string };
          sessions: { performed_on: string };
        };
      }[]
    >();
  if (error) throw error;
  return (data ?? []).map((row) => ({
    performed_on: row.session_exercises.sessions.performed_on,
    weight: row.weight,
    reps: row.reps,
    duration_seconds: row.duration_seconds,
    done: row.done,
    muscle_group: row.session_exercises.exercise.muscle_group,
    exercise_id: row.session_exercises.exercise.id,
    exercise_name: row.session_exercises.exercise.name,
    exercise_type: row.session_exercises.exercise.type,
  }));
}

/** Re-export the set type so callers don't reach into types directly. */
export type { WorkoutSet };

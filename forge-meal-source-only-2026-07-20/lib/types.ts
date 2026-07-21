/** Domain types mirroring the Supabase schema (see supabase/migrations). */

export type ExerciseType = "strength" | "cardio";

export interface Regime {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  started_on: string; // ISO date
  ended_on: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Exercise {
  id: string;
  user_id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  type: ExerciseType;
  created_at: string;
}

export interface Routine {
  id: string;
  user_id: string;
  regime_id: string;
  day_of_week: number | null; // 0=Sun … 6=Sat, null = any day
  name: string;
  position: number;
  created_at: string;
}

export interface RoutineExercise {
  id: string;
  user_id: string;
  routine_id: string;
  exercise_id: string;
  position: number;
  target_sets: number | null;
  target_reps: string | null; // free text e.g. "8-10"
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  regime_id: string;
  routine_id: string | null;
  performed_on: string; // ISO date
  notes: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface SessionExercise {
  id: string;
  user_id: string;
  session_id: string;
  exercise_id: string;
  position: number;
  notes: string | null;
  created_at: string;
}

export interface WorkoutSet {
  id: string;
  user_id: string;
  session_exercise_id: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds: number | null; // cardio
  level: number | null; // cardio (e.g. stair-master level)
  done: boolean;
  created_at: string;
}

export interface BodyStat {
  id: string;
  user_id: string;
  recorded_on: string; // ISO date
  bodyweight: number | null;
  body_fat: number | null;
  sleep_hours: number | null;
  resting_hr: number | null;
  notes: string | null;
  created_at: string;
}

/**
 * Day-level metrics synced from a wearable (see supabase/migrations/0004).
 * Consolidated health timeline. MacroDroid is the primary source, with manual
 * edits available in the app for corrections or values the watch cannot send.
 */
export interface DailyHealth {
  id: string;
  user_id: string;
  recorded_on: string; // ISO date
  bodyweight: number | null;
  steps: number | null;
  active_kcal: number | null;
  total_kcal: number | null;
  distance_m: number | null;
  sleep_minutes: number | null;
  resting_hr: number | null;
  avg_hr: number | null;
  source: string;
  synced_at: string;
  created_at: string;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "meal";
export type NutritionConfidence = "high" | "medium" | "low";

export interface Meal {
  id: string;
  user_id: string;
  logged_on: string;
  meal_type: MealType;
  title: string;
  original_input: string;
  assumptions: string[];
  created_at: string;
}

export interface MealItem {
  id: string;
  user_id: string;
  meal_id: string;
  name: string;
  brand: string | null;
  quantity: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  source_url: string | null;
  source_title: string | null;
  confidence: NutritionConfidence;
  position: number;
  created_at: string;
}

/* ── Composed shapes used by the UI ──────────────────────────────────────── */

/** A routine joined with its ordered exercises (the day template). */
export interface RoutineWithExercises extends Routine {
  routine_exercises: (RoutineExercise & { exercise: Exercise })[];
}

/** A session exercise joined with its catalog exercise and its sets. */
export interface SessionExerciseFull extends SessionExercise {
  exercise: Exercise;
  sets: WorkoutSet[];
}

/** A full, editable workout session as rendered on the logging screen. */
export interface SessionFull extends Session {
  routine: Routine | null;
  session_exercises: SessionExerciseFull[];
}

/** A conversational meal joined with its researched nutrition items. */
export interface MealWithItems extends Meal {
  meal_items: MealItem[];
}

/** A preserved note from an earlier workout or exercise occurrence. */
export interface NoteHistoryEntry {
  id: string;
  performed_on: string;
  notes: string;
}

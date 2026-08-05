function setVolume(weight: number, reps: number): number {
  return weight * reps;
}

function estimateOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

export interface ExportSet {
  id: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds: number | null;
  level: number | null;
  done: boolean;
  created_at: string;
}

export interface ExportSessionExercise {
  id: string;
  position: number;
  notes: string | null;
  created_at: string;
  exercise: {
    id: string;
    name: string;
    muscle_group: string | null;
    equipment: string | null;
    type: "strength" | "cardio";
  };
  sets: ExportSet[];
}

export interface ExportSession {
  id: string;
  performed_on: string;
  notes: string | null;
  finished_at: string | null;
  created_at: string;
  regime: { id: string; name: string; started_on: string; ended_on: string | null } | null;
  routine: { id: string; name: string; day_of_week: number | null; position: number } | null;
  session_exercises: ExportSessionExercise[];
}

export interface WorkoutExport {
  generated_at: string;
  date_range: { from: string | null; to: string | null };
  summary: {
    workouts: number;
    finished_workouts: number;
    exercises: number;
    sets: number;
    completed_sets: number;
    strength_volume: number;
  };
  workouts: ExportSession[];
  exercise_trends: {
    exercise: ExportSessionExercise["exercise"];
    entries: {
      date: string;
      workout_id: string;
      completed_sets: number;
      total_reps: number;
      strength_volume: number;
      best_weight: number | null;
      estimated_one_rep_max: number | null;
      cardio_duration_seconds: number;
    }[];
  }[];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sortWorkout(workout: ExportSession): ExportSession {
  workout.session_exercises.sort((a, b) => a.position - b.position);
  for (const exercise of workout.session_exercises) {
    exercise.sets.sort((a, b) => a.set_number - b.set_number);
  }
  return workout;
}

/** Converts raw service-client rows into stable, analysis-friendly workout JSON. */
export function buildWorkoutExport(
  rows: ExportSession[],
  dateRange: WorkoutExport["date_range"],
  generatedAt = new Date().toISOString(),
): WorkoutExport {
  const workouts = rows.map(sortWorkout).sort((a, b) => b.performed_on.localeCompare(a.performed_on));
  const trends = new Map<
    string,
    { exercise: ExportSessionExercise["exercise"]; entries: WorkoutExport["exercise_trends"][number]["entries"] }
  >();
  let exercises = 0;
  let sets = 0;
  let completedSets = 0;
  let strengthVolume = 0;

  for (const workout of workouts) {
    exercises += workout.session_exercises.length;
    for (const occurrence of workout.session_exercises) {
      sets += occurrence.sets.length;
      const done = occurrence.sets.filter((entry) => entry.done);
      completedSets += done.length;
      const strengthSets = done.filter(
        (entry) => entry.weight != null && entry.reps != null && occurrence.exercise.type === "strength",
      );
      const volume = strengthSets.reduce((total, entry) => total + setVolume(entry.weight!, entry.reps!), 0);
      strengthVolume += volume;
      const estimatedMaxes = strengthSets.map((entry) => estimateOneRepMax(entry.weight!, entry.reps!));
      const entry = {
        date: workout.performed_on,
        workout_id: workout.id,
        completed_sets: done.length,
        total_reps: done.reduce((total, item) => total + (numberOrNull(item.reps) ?? 0), 0),
        strength_volume: volume,
        best_weight: strengthSets.reduce<number | null>(
          (best, item) => Math.max(best ?? 0, item.weight ?? 0),
          null,
        ),
        estimated_one_rep_max: estimatedMaxes.length > 0 ? Math.max(...estimatedMaxes) : null,
        cardio_duration_seconds: done.reduce(
          (total, item) => total + (numberOrNull(item.duration_seconds) ?? 0),
          0,
        ),
      };
      const trend = trends.get(occurrence.exercise.id) ?? { exercise: occurrence.exercise, entries: [] };
      trend.entries.push(entry);
      trends.set(occurrence.exercise.id, trend);
    }
  }

  return {
    generated_at: generatedAt,
    date_range: dateRange,
    summary: {
      workouts: workouts.length,
      finished_workouts: workouts.filter((workout) => workout.finished_at !== null).length,
      exercises,
      sets,
      completed_sets: completedSets,
      strength_volume: strengthVolume,
    },
    workouts,
    exercise_trends: [...trends.values()]
      .map((trend) => ({ ...trend, entries: trend.entries.sort((a, b) => a.date.localeCompare(b.date)) }))
      .sort((a, b) => a.exercise.name.localeCompare(b.exercise.name)),
  };
}

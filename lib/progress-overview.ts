import type { OverviewSetRow } from "./queries";
import { estimateOneRepMax, parseISODate, setVolume, toISODate } from "./format";
import { mondayOf } from "./reports";

export interface OverviewSetSummary {
  weight: number | null;
  reps: number | null;
  count: number;
}

export interface ExerciseProgress {
  date: string;
  exerciseId: string;
  exerciseName: string;
  exerciseType: string;
  completedSets: number;
  setSummaries: OverviewSetSummary[];
  currentEstimatedMax: number | null;
  priorEstimatedMax: number | null;
  recentEstimatedMaxes: number[];
}

export interface OverviewDay {
  date: string;
  sessions: number;
  routines: string[];
  exercises: number;
  completedSets: number;
  volume: number;
  exerciseProgress: ExerciseProgress[];
}

export interface StrengthComparison {
  comparableLifts: number;
  improvedLifts: number;
}

export interface ProgressOverview {
  days: Map<string, OverviewDay>;
  completedSessionsThisWeek: number;
  totalCompletedSessions: number;
  averageSessionsPerWeek: number | null;
  weeklySessions: { label: string; value: number }[];
  strength: StrengthComparison;
}

interface ExerciseOccurrence {
  date: string;
  estimatedMax: number | null;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function buildSetSummaries(rows: OverviewSetRow[]): OverviewSetSummary[] {
  const summaries = new Map<string, OverviewSetSummary>();
  for (const row of rows) {
    const key = `${row.weight ?? "bodyweight"}-${row.reps ?? "untracked"}`;
    const current = summaries.get(key);
    if (current) {
      current.count += 1;
    } else {
      summaries.set(key, { weight: row.weight, reps: row.reps, count: 1 });
    }
  }
  return [...summaries.values()];
}

function estimatedMax(rows: OverviewSetRow[]): number | null {
  const values = rows.flatMap((row) =>
    row.weight != null && row.reps != null ? [estimateOneRepMax(row.weight, row.reps)] : [],
  );
  return values.length > 0 ? Math.max(...values) : null;
}

function buildExerciseProgress(entries: OverviewSetRow[]): ExerciseProgress[] {
  const rowsByDateAndExercise = new Map<string, OverviewSetRow[]>();
  const occurrencesByExercise = new Map<string, ExerciseOccurrence[]>();

  for (const entry of entries) {
    const key = `${entry.performed_on}:${entry.exercise_id}`;
    const dateRows = rowsByDateAndExercise.get(key) ?? [];
    dateRows.push(entry);
    rowsByDateAndExercise.set(key, dateRows);
  }

  for (const [key, rows] of rowsByDateAndExercise) {
    const [date, exerciseId] = key.split(":");
    if (!date || !exerciseId) continue;
    const occurrences = occurrencesByExercise.get(exerciseId) ?? [];
    occurrences.push({ date, estimatedMax: estimatedMax(rows) });
    occurrencesByExercise.set(exerciseId, occurrences);
  }

  for (const occurrences of occurrencesByExercise.values()) {
    occurrences.sort((left, right) => left.date.localeCompare(right.date));
  }

  const progress: ExerciseProgress[] = [];
  for (const [key, rows] of rowsByDateAndExercise) {
    const [date, exerciseId] = key.split(":");
    if (!date || !exerciseId) continue;
    const occurrences = occurrencesByExercise.get(exerciseId) ?? [];
    const occurrenceIndex = occurrences.findIndex((occurrence) => occurrence.date === date);
    const priorOccurrence = occurrenceIndex > 0 ? occurrences[occurrenceIndex - 1] : null;
    const recentEstimatedMaxes = occurrences
      .slice(Math.max(0, occurrenceIndex - 5), occurrenceIndex + 1)
      .flatMap((occurrence) => (occurrence.estimatedMax == null ? [] : [occurrence.estimatedMax]));
    const first = rows[0];
    if (!first) continue;
    progress.push({
      date,
      exerciseId,
      exerciseName: first.exercise_name,
      exerciseType: first.exercise_type,
      completedSets: rows.length,
      setSummaries: buildSetSummaries(rows),
      currentEstimatedMax: estimatedMax(rows),
      priorEstimatedMax: priorOccurrence?.estimatedMax ?? null,
      recentEstimatedMaxes,
    });
  }

  return progress.sort((left, right) => left.exerciseName.localeCompare(right.exerciseName));
}

export function buildProgressOverview(rows: OverviewSetRow[], today = new Date()): ProgressOverview {
  const normalizedToday = startOfDay(today);
  const metricsRows = rows.filter((row) => parseISODate(row.performed_on) <= normalizedToday);
  const thisMonday = mondayOf(normalizedToday);
  const thisWeek = toISODate(thisMonday);
  const sessionDates = new Map<string, string>();
  const dayRows = new Map<string, OverviewSetRow[]>();

  for (const row of metricsRows) {
    sessionDates.set(row.session_id, row.performed_on);
    const entries = dayRows.get(row.performed_on) ?? [];
    entries.push(row);
    dayRows.set(row.performed_on, entries);
  }

  const exerciseProgress = buildExerciseProgress(metricsRows);
  const exerciseProgressByDate = new Map<string, ExerciseProgress[]>();
  for (const exercise of exerciseProgress) {
    const items = exerciseProgressByDate.get(exercise.date) ?? [];
    items.push(exercise);
    exerciseProgressByDate.set(exercise.date, items);
  }

  const days = new Map<string, OverviewDay>();
  for (const [date, entries] of dayRows) {
    const sessionIds = new Set(entries.map((entry) => entry.session_id));
    const routines = [...new Set(entries.map((entry) => entry.routine_name).filter((name): name is string => Boolean(name)))];
    const exercises = new Set(entries.map((entry) => entry.exercise_id));
    const strengthSets = entries.filter(
      (entry) => entry.exercise_type === "strength" && entry.weight != null && entry.reps != null,
    );
    const volume = strengthSets.reduce((total, entry) => total + setVolume(entry.weight, entry.reps), 0);

    days.set(date, {
      date,
      sessions: sessionIds.size,
      routines,
      exercises: exercises.size,
      completedSets: entries.length,
      volume,
      exerciseProgress: exerciseProgressByDate.get(date) ?? [],
    });
  }

  const uniqueSessions = [...sessionDates.entries()];
  const completedSessionsThisWeek = uniqueSessions.filter(([, date]) => date >= thisWeek).length;
  const totalCompletedSessions = uniqueSessions.length;
  const firstSession = uniqueSessions.reduce<string | null>(
    (first, [, date]) => (!first || date < first ? date : first),
    null,
  );
  const firstMonday = firstSession ? mondayOf(parseISODate(firstSession)) : null;
  const elapsedWeeks = firstMonday
    ? Math.max(1, Math.floor((normalizedToday.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1)
    : 0;

  const weeklySessions = Array.from({ length: 8 }, (_, index) => {
    const weekStart = addDays(thisMonday, (index - 7) * 7);
    const weekEnd = addDays(weekStart, 7);
    const value = uniqueSessions.filter(([, date]) => {
      const sessionDate = parseISODate(date);
      return sessionDate >= weekStart && sessionDate < weekEnd;
    }).length;
    return { label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`, value };
  });

  const currentPeriodStart = addDays(thisMonday, -21);
  const previousPeriodStart = addDays(currentPeriodStart, -28);
  const bestByLiftAndPeriod = new Map<string, { previous: number | null; current: number | null }>();
  for (const row of metricsRows) {
    if (row.exercise_type !== "strength" || row.weight == null || row.reps == null) continue;
    const date = parseISODate(row.performed_on);
    if (date < previousPeriodStart || date > normalizedToday) continue;
    const period = date < currentPeriodStart ? "previous" : "current";
    const best = estimateOneRepMax(row.weight, row.reps);
    const values = bestByLiftAndPeriod.get(row.exercise_id) ?? { previous: null, current: null };
    values[period] = Math.max(values[period] ?? 0, best);
    bestByLiftAndPeriod.set(row.exercise_id, values);
  }
  const comparisons = [...bestByLiftAndPeriod.values()].filter(
    (value): value is { previous: number; current: number } => value.previous != null && value.current != null,
  );

  return {
    days,
    completedSessionsThisWeek,
    totalCompletedSessions,
    averageSessionsPerWeek: elapsedWeeks > 0 ? Math.round((totalCompletedSessions / elapsedWeeks) * 10) / 10 : null,
    weeklySessions,
    strength: {
      comparableLifts: comparisons.length,
      improvedLifts: comparisons.filter((value) => value.current > value.previous).length,
    },
  };
}

import type { OverviewSetRow } from "./queries";
import { estimateOneRepMax, parseISODate, setVolume, toISODate } from "./format";
import { mondayOf } from "./reports";

export interface OverviewDay {
  date: string;
  sessions: number;
  routines: string[];
  exercises: number;
  completedSets: number;
  volume: number;
  bestSet: { exerciseName: string; weight: number; reps: number } | null;
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
  weeklyVolume: { label: string; value: number }[];
  strength: StrengthComparison;
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

  const days = new Map<string, OverviewDay>();
  for (const [date, entries] of dayRows) {
    const sessionIds = new Set(entries.map((entry) => entry.session_id));
    const routines = [...new Set(entries.map((entry) => entry.routine_name).filter((name): name is string => Boolean(name)))];
    const exercises = new Set(entries.map((entry) => entry.exercise_id));
    const strengthSets = entries.filter(
      (entry) => entry.exercise_type === "strength" && entry.weight != null && entry.reps != null,
    );
    const volume = strengthSets.reduce((total, entry) => total + setVolume(entry.weight, entry.reps), 0);
    const best = strengthSets.reduce<OverviewDay["bestSet"]>((current, entry) => {
      if (entry.weight == null || entry.reps == null) return current;
      if (!current || entry.weight > current.weight || (entry.weight === current.weight && entry.reps > current.reps)) {
        return { exerciseName: entry.exercise_name, weight: entry.weight, reps: entry.reps };
      }
      return current;
    }, null);

    days.set(date, {
      date,
      sessions: sessionIds.size,
      routines,
      exercises: exercises.size,
      completedSets: entries.length,
      volume,
      bestSet: best,
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

  const weeklyVolume = Array.from({ length: 8 }, (_, index) => {
    const weekStart = addDays(thisMonday, (index - 7) * 7);
    const weekEnd = addDays(weekStart, 7);
    const value = metricsRows
      .filter((row) => {
        const date = parseISODate(row.performed_on);
        return (
          row.exercise_type === "strength" &&
          row.weight != null &&
          row.reps != null &&
          date >= weekStart &&
          date < weekEnd
        );
      })
      .reduce((total, row) => total + setVolume(row.weight, row.reps), 0);
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
    weeklyVolume,
    strength: {
      comparableLifts: comparisons.length,
      improvedLifts: comparisons.filter((value) => value.current > value.previous).length,
    },
  };
}

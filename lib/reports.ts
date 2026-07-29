import type { ReportSetRow } from "./queries";
import { parseISODate, setVolume, toISODate } from "./format";

/** Monday of the week containing `d` (local time). */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export interface Report {
  sessions: number;
  totalVolume: number;
  avgSessionsPerWeek: number;
  weeklyVolume: { label: string; value: number; weekStart: string; sessions: number }[];
  muscleVolume: { label: string; value: number }[];
}

/**
 * Aggregate logged sets into a report over the trailing `weeks` weeks.
 * Volume counts strength sets that have both weight and reps; cardio is excluded
 * from volume (it has no load).
 */
export function buildReport(rows: ReportSetRow[], weeks: number, today = new Date()): Report {
  const strength = rows.filter(
    (r) => r.exercise_type === "strength" && r.weight != null && r.reps != null,
  );

  const totalVolume = strength.reduce((sum, r) => sum + setVolume(r.weight, r.reps), 0);
  const sessions = new Set(rows.map((r) => r.performed_on)).size;
  const avgSessionsPerWeek = weeks > 0 ? Math.round((sessions / weeks) * 10) / 10 : 0;

  // Weekly volume buckets (oldest → newest).
  const thisMonday = mondayOf(today);
  const buckets: { label: string; value: number; weekStart: string; sessions: number }[] = [];
  const keyIndex = new Map<string, number>();
  const sessionDays = new Map<string, Set<string>>();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisMonday);
    d.setDate(d.getDate() - i * 7);
    const weekStart = toISODate(d);
    keyIndex.set(weekStart, buckets.length);
    sessionDays.set(weekStart, new Set());
    buckets.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, value: 0, weekStart, sessions: 0 });
  }
  for (const r of rows) {
    const weekStart = toISODate(mondayOf(parseISODate(r.performed_on)));
    sessionDays.get(weekStart)?.add(r.performed_on);
  }
  for (const bucket of buckets) bucket.sessions = sessionDays.get(bucket.weekStart)?.size ?? 0;
  for (const r of strength) {
    const wk = toISODate(mondayOf(parseISODate(r.performed_on)));
    const idx = keyIndex.get(wk);
    if (idx !== undefined) buckets[idx].value += setVolume(r.weight, r.reps);
  }

  // Volume by muscle group (desc).
  const muscleMap = new Map<string, number>();
  for (const r of strength) {
    const m = r.muscle_group ?? "Other";
    muscleMap.set(m, (muscleMap.get(m) ?? 0) + setVolume(r.weight, r.reps));
  }
  const muscleVolume = [...muscleMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return { sessions, totalVolume, avgSessionsPerWeek, weeklyVolume: buckets, muscleVolume };
}

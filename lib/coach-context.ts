import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getActiveRegime,
  getBodyStats,
  getMeals,
  getRecentSessions,
  getRoutinesWithExercises,
  getSetsSince,
} from "./queries";
import { buildReport } from "./reports";
import { dayOfWeekFor, parseISODate, toISODate, todayISODate } from "./format";
import { WEIGHT_UNIT, dayLabel } from "./constants";
import { mealMacros } from "./nutrition";

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function md(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Build a compact, factual snapshot of the user's recent training for the AI.
 * Plain text (not JSON) so the model reads it naturally. Runs client-side.
 */
export async function buildCoachContext(sb: SupabaseClient): Promise<string> {
  const today = todayISODate();
  const dow = dayOfWeekFor();

  const regime = await getActiveRegime(sb);
  if (!regime) return "The user has no active regime yet — they haven't set up training.";

  const since = toISODate(addDays(new Date(), -28));
  const [routines, recent, rows, stats, meals] = await Promise.all([
    getRoutinesWithExercises(sb, regime.id),
    getRecentSessions(sb, 25),
    getSetsSince(sb, since),
    getBodyStats(sb, 3),
    // Meal logging was added after the original schema. Keep the workout coach
    // usable during a rolling deploy where migration 0005 is not applied yet.
    getMeals(sb, 100).catch(() => []),
  ]);

  const lines: string[] = [];
  lines.push(`Today: ${today} (${dayLabel(dow)}). Units: ${WEIGHT_UNIT}.`);
  lines.push(`Active regime: "${regime.name}" (since ${regime.started_on}).`);

  const dueToday = routines.find((r) => r.day_of_week === dow);
  lines.push(
    dueToday
      ? `Routine due today: "${dueToday.name}" (${dueToday.routine_exercises.length} exercises).`
      : `No routine scheduled for ${dayLabel(dow)} (rest day or unplanned).`,
  );

  // Consistency + last session.
  const last28 = recent.filter((s) => s.performed_on >= since);
  const report = buildReport(rows, 2);
  lines.push(
    `Sessions in last 28 days: ${last28.length} (~${Math.round((last28.length / 4) * 10) / 10}/week).`,
  );
  if (recent[0]) {
    lines.push(`Most recent session: ${recent[0].performed_on}.`);
  }
  lines.push(
    `Strength volume this week: ${Math.round(report.weeklyVolume[1]?.value ?? 0)} ${WEIGHT_UNIT}; ` +
      `last week: ${Math.round(report.weeklyVolume[0]?.value ?? 0)} ${WEIGHT_UNIT}.`,
  );

  // Per-exercise recent progression (top set per session).
  interface ExAgg {
    name: string;
    type: string;
    byDate: Map<string, { w: number | null; r: number | null; dur: number | null }>;
  }
  const byEx = new Map<string, ExAgg>();
  for (const row of rows) {
    let agg = byEx.get(row.exercise_id);
    if (!agg) {
      agg = { name: row.exercise_name, type: row.exercise_type, byDate: new Map() };
      byEx.set(row.exercise_id, agg);
    }
    const cur = agg.byDate.get(row.performed_on);
    if (row.exercise_type === "cardio") {
      if (row.duration_seconds != null && (!cur || (cur.dur ?? -1) < row.duration_seconds)) {
        agg.byDate.set(row.performed_on, { w: null, r: null, dur: row.duration_seconds });
      }
    } else if (row.weight != null && (!cur || (cur.w ?? -1) < row.weight)) {
      agg.byDate.set(row.performed_on, { w: row.weight, r: row.reps, dur: null });
    }
  }

  const progression = [...byEx.values()]
    .filter((agg) => agg.byDate.size > 0) // skip exercises with no logged numbers yet
    .sort((a, b) => b.byDate.size - a.byDate.size)
    .slice(0, 6)
    .map((agg) => {
      const dates = [...agg.byDate.keys()].sort();
      const fmt = (iso: string) => {
        const v = agg.byDate.get(iso)!;
        return agg.type === "cardio"
          ? `${v.dur ? Math.round(v.dur / 60) : "?"}min`
          : `${v.w ?? "?"}×${v.r ?? "?"}`;
      };
      if (dates.length === 1) return `- ${agg.name}: ${fmt(dates[0])} (${md(dates[0])})`;
      const prev = dates[dates.length - 2];
      const last = dates[dates.length - 1];
      return `- ${agg.name}: ${fmt(prev)} (${md(prev)}) → ${fmt(last)} (${md(last)})`;
    });

  if (progression.length > 0) {
    lines.push("Recent top-set progression:");
    lines.push(...progression);
  }

  const latest = stats[0];
  if (latest) {
    const parts: string[] = [];
    if (latest.bodyweight != null) parts.push(`bodyweight ${latest.bodyweight} ${WEIGHT_UNIT}`);
    if (latest.sleep_hours != null) parts.push(`sleep ${latest.sleep_hours}h`);
    if (latest.resting_hr != null) parts.push(`resting HR ${latest.resting_hr}`);
    if (parts.length) lines.push(`Latest body stats (${latest.recorded_on}): ${parts.join(", ")}.`);
  }

  const nutritionSince = toISODate(addDays(new Date(), -6));
  const recentMeals = meals.filter((meal) => meal.logged_on >= nutritionSince && meal.logged_on <= today);
  if (recentMeals.length > 0) {
    const byDay = new Map<string, typeof recentMeals>();
    for (const meal of recentMeals) {
      const day = byDay.get(meal.logged_on) ?? [];
      day.push(meal);
      byDay.set(meal.logged_on, day);
    }
    const perDay = [...byDay.values()].map(mealMacros);
    const average = (key: "calories" | "protein_g") =>
      Math.round(perDay.reduce((sum, macros) => sum + macros[key], 0) / perDay.length);
    lines.push(
      `Nutrition logged on ${perDay.length} of the last 7 days: average ${average("calories")} calories and ${average("protein_g")}g protein on logged days.`,
    );
    const todayMeals = byDay.get(today);
    if (todayMeals?.length) {
      const todayMacros = mealMacros(todayMeals);
      lines.push(`Today so far: ${todayMacros.calories} calories, ${todayMacros.protein_g}g protein.`);
    }
  }

  return lines.join("\n");
}

import type { SupabaseClient } from "@supabase/supabase-js";

export const SHARE_WEEKDAYS = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
] as const;

export type ShareWeekday = (typeof SHARE_WEEKDAYS)[number]["day"];
export type ShareCart = Record<ShareWeekday, string[]>;

interface ExerciseOccurrence {
  position: number;
  exercise: { id: string; name: string };
  sessions: { performed_on: string };
}

function weekdayForDate(date: string): ShareWeekday {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).getDay() as ShareWeekday;
}

/**
 * Deduplicate every exercise ever performed on a weekday. The latest workout
 * arrangement becomes the starting order; the user may freely edit it in the cart.
 */
export function buildWorkoutShareCart(rows: ExerciseOccurrence[]): ShareCart {
  const cart = Object.fromEntries(SHARE_WEEKDAYS.map(({ day }) => [day, []])) as unknown as ShareCart;
  const seen = Object.fromEntries(SHARE_WEEKDAYS.map(({ day }) => [day, new Set<string>()])) as Record<
    ShareWeekday,
    Set<string>
  >;

  const ordered = [...rows].sort((left, right) =>
    right.sessions.performed_on.localeCompare(left.sessions.performed_on) || left.position - right.position,
  );
  for (const row of ordered) {
    const day = weekdayForDate(row.sessions.performed_on);
    const name = row.exercise.name.trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen[day].has(key)) continue;
    seen[day].add(key);
    cart[day].push(name);
  }
  return cart;
}

/** All historical exercises the signed-in user has actually logged, grouped for sharing. */
export async function getWorkoutShareCart(sb: SupabaseClient): Promise<ShareCart> {
  const { data, error } = await sb
    .from("session_exercises")
    .select("position, exercise:exercises(id, name), sessions!inner(performed_on)")
    .returns<ExerciseOccurrence[]>();
  if (error) throw error;
  return buildWorkoutShareCart(data ?? []);
}

export function buildWorkoutShareFile(cart: ShareCart, selectedDays: ShareWeekday[]) {
  return {
    format: "forge-workout-template-v1",
    exported_at: new Date().toISOString(),
    days: SHARE_WEEKDAYS
      .filter(({ day }) => selectedDays.includes(day))
      .map(({ day, label }) => ({ day: label, exercises: cart[day] })),
  };
}

/** App-wide constants. Change APP_NAME / accent in one place to rebrand. */

export const APP_NAME = "Forge";
export const APP_TAGLINE = "A smart, fast workout logger.";

/** Display unit for loads. Stored values are unitless numbers; this is the label. */
export const WEIGHT_UNIT = "lb";

/** 0 = Sunday … 6 = Saturday, matching JS Date.getDay(). */
export const DAYS_OF_WEEK = [
  { value: 0, short: "Sun", full: "Sunday" },
  { value: 1, short: "Mon", full: "Monday" },
  { value: 2, short: "Tue", full: "Tuesday" },
  { value: 3, short: "Wed", full: "Wednesday" },
  { value: 4, short: "Thu", full: "Thursday" },
  { value: 5, short: "Fri", full: "Friday" },
  { value: 6, short: "Sat", full: "Saturday" },
] as const;

export function dayLabel(dayOfWeek: number | null | undefined): string {
  if (dayOfWeek === null || dayOfWeek === undefined) return "Any day";
  return DAYS_OF_WEEK.find((d) => d.value === dayOfWeek)?.full ?? "Any day";
}

/** Muscle groups power the per-muscle volume report. Kept short and practical. */
export const MUSCLE_GROUPS = [
  "Chest",
  "Upper chest",
  "Back",
  "Lats",
  "Shoulders",
  "Side delts",
  "Rear delts",
  "Biceps",
  "Triceps",
  "Forearms",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Core",
  "Cardio",
  "Full body",
] as const;

export const EQUIPMENT = [
  "Barbell",
  "Dumbbell",
  "Machine",
  "Cable",
  "Smith machine",
  "Bodyweight",
  "Kettlebell",
  "Band",
  "Other",
] as const;

/* ── AI coach (insight-on-open) ──────────────────────────────────────────── */

export const INSIGHT_CACHE_KEY = "forge-coach-insight-v1";
/** How long a generated insight stays fresh before we ask for a new one. */
export const INSIGHT_TTL_MINUTES = 180;

/**
 * Rotating "angles" so the on-open insight stays fresh instead of repeating.
 * One is picked per generation; the model is told to take that specific angle.
 */
export const INSIGHT_ANGLES = [
  "progression on a key lift — call out a concrete weight or rep increase vs last time",
  "a plateau or stall — a lift that hasn't moved in 2+ sessions, with one fix to try",
  "training volume — whether total sets/volume is trending up or down recently",
  "consistency — sessions logged per week and whether the streak is holding",
  "recovery — relate bodyweight or sleep to performance if the data is there",
  "a concrete suggestion for the very next session — be specific to the routine due next",
  "a small win worth noticing — a PR or a clean progression the user might have missed",
] as const;

export const WORKOUT_TEMPLATE_FORMAT = "forge-workout-template-v1";

const WEEKDAYS = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
] as const;

export interface ImportedWorkoutTemplateDay {
  day: (typeof WEEKDAYS)[number]["day"];
  label: string;
  exercises: string[];
}

export interface ImportedWorkoutTemplate {
  days: ImportedWorkoutTemplateDay[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the small, portable file produced by Forge's workout sharing cart. */
export function parseWorkoutTemplate(value: unknown): ImportedWorkoutTemplate {
  if (!isRecord(value) || value.format !== WORKOUT_TEMPLATE_FORMAT || !Array.isArray(value.days)) {
    throw new Error("This isn't a Forge workout template file.");
  }
  if (value.days.length === 0 || value.days.length > WEEKDAYS.length) {
    throw new Error("The template needs between one and seven days.");
  }

  const byLabel = new Map<string, (typeof WEEKDAYS)[number]>(
    WEEKDAYS.map((weekday) => [weekday.label, weekday]),
  );
  const seenDays = new Set<string>();

  const days = value.days.map((valueDay) => {
    if (!isRecord(valueDay) || typeof valueDay.day !== "string" || !Array.isArray(valueDay.exercises)) {
      throw new Error("One of the template days is invalid.");
    }
    const weekday = byLabel.get(valueDay.day);
    if (!weekday || seenDays.has(weekday.label)) {
      throw new Error("The template contains an invalid or repeated day.");
    }
    seenDays.add(weekday.label);

    const seenExercises = new Set<string>();
    const exercises = valueDay.exercises.map((exercise) => {
      if (typeof exercise !== "string") throw new Error("An exercise name is invalid.");
      const name = exercise.trim();
      if (!name || name.length > 120) throw new Error("An exercise name is invalid.");
      const normalized = name.toLocaleLowerCase();
      if (seenExercises.has(normalized)) throw new Error("The same exercise appears twice on a day.");
      seenExercises.add(normalized);
      return name;
    });

    return { day: weekday.day, label: weekday.label, exercises };
  });

  return { days };
}

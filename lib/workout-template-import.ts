export const WORKOUT_TEMPLATE_FORMAT = "forge-workout-template-v1";
export const WORKOUT_TEMPLATE_FORMAT_V2 = "forge-workout-template-v2";

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

export interface ImportedWorkoutExercise {
  name: string;
  type: "strength" | "cardio";
  muscle_group: string | null;
  equipment: string | null;
  target_sets: number | null;
  target_reps: string | null;
}

export interface ImportedWorkoutTemplateV2Day {
  day: (typeof WEEKDAYS)[number]["day"];
  label: string;
  routine: string;
  exercises: ImportedWorkoutExercise[];
}

export interface ImportedWorkoutTemplateV2 {
  format: typeof WORKOUT_TEMPLATE_FORMAT_V2;
  name: string;
  notes: string | null;
  days: ImportedWorkoutTemplateV2Day[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the small, portable file produced by Forge's workout sharing cart. */
export function parseWorkoutTemplate(value: unknown): ImportedWorkoutTemplate | ImportedWorkoutTemplateV2 {
  if (isRecord(value) && value.format === WORKOUT_TEMPLATE_FORMAT_V2) {
    return parseV2(value);
  }
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

function boundedString(value: unknown, message: string, max = 120): string {
  if (typeof value !== "string") throw new Error(message);
  const result = value.trim();
  if (!result || result.length > max) throw new Error(message);
  return result;
}

function optionalString(value: unknown, message: string, max = 120): string | null {
  if (value === undefined || value === null) return null;
  return boundedString(value, message, max);
}

function parseV2(value: Record<string, unknown>): ImportedWorkoutTemplateV2 {
  const regimen = isRecord(value.regimen) ? value.regimen : isRecord(value.regime) ? value.regime : null;
  const name = boundedString(value.name ?? value.regimen_name ?? regimen?.name, "The regimen name is invalid.");
  const notes = optionalString(value.notes ?? regimen?.notes, "The regimen notes are invalid.", 2000);
  if (!Array.isArray(value.days) || value.days.length === 0 || value.days.length > WEEKDAYS.length) {
    throw new Error("The template needs between one and seven days.");
  }

  const byLabel = new Map<string, (typeof WEEKDAYS)[number]>(WEEKDAYS.map((weekday) => [weekday.label, weekday]));
  const seenDays = new Set<string>();
  const days = value.days.map((valueDay) => {
    if (!isRecord(valueDay) || typeof (valueDay.day ?? valueDay.weekday) !== "string" || !Array.isArray(valueDay.exercises)) {
      throw new Error("One of the template days is invalid.");
    }
    const weekday = byLabel.get((valueDay.day ?? valueDay.weekday) as string);
    if (!weekday || seenDays.has(weekday.label)) {
      throw new Error("The template contains an invalid or repeated day.");
    }
    seenDays.add(weekday.label);
    const routine = boundedString(valueDay.routine ?? valueDay.routine_name, "A routine name is invalid.");
    const seenExercises = new Set<string>();
    const exercises = valueDay.exercises.map((valueExercise) => {
      if (!isRecord(valueExercise)) throw new Error("One of the exercises is invalid.");
      const exerciseName = boundedString(valueExercise.name, "An exercise name is invalid.");
      const key = exerciseName.toLocaleLowerCase();
      if (seenExercises.has(key)) throw new Error("The same exercise appears twice on a day.");
      seenExercises.add(key);
      const type = valueExercise.type ?? "strength";
      const exerciseType: "strength" | "cardio" | null = type === "cardio" ? "cardio" : type === "strength" ? "strength" : null;
      if (!exerciseType) throw new Error("An exercise type is invalid.");
      const targetSets = valueExercise.target_sets;
      if (targetSets !== undefined && targetSets !== null && (typeof targetSets !== "number" || !Number.isInteger(targetSets) || targetSets < 1 || targetSets > 20)) {
        throw new Error("Target sets must be an integer from 1 to 20 or null.");
      }
      return {
        name: exerciseName,
        type: exerciseType,
        muscle_group: optionalString(valueExercise.muscle_group, "An exercise muscle group is invalid."),
        equipment: optionalString(valueExercise.equipment, "An exercise equipment value is invalid."),
        target_sets: (targetSets as number | null | undefined) ?? null,
        target_reps: optionalString(valueExercise.target_reps, "Target reps are invalid."),
      };
    });
    return { day: weekday.day, label: weekday.label, routine, exercises };
  });

  return { format: WORKOUT_TEMPLATE_FORMAT_V2, name, notes, days };
}

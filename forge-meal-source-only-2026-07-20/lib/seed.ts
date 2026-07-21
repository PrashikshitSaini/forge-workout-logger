import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExerciseType } from "./types";
import {
  addRoutineExercise,
  createInitialRegime,
  createRoutine,
  findOrCreateExercise,
} from "./mutations";

/**
 * First-run seed. Per the owner's request, only MONDAY is pre-filled; the other
 * days are left empty so the create-a-routine flow gets exercised manually.
 */

interface SeedExercise {
  name: string;
  muscle_group: string;
  equipment: string;
  type: ExerciseType;
  target_sets: number;
  target_reps: string | null;
}

const MONDAY: SeedExercise[] = [
  { name: "Incline Dumbbell Press", muscle_group: "Upper chest", equipment: "Dumbbell", type: "strength", target_sets: 3, target_reps: "8-10" },
  { name: "Machine Chest Press", muscle_group: "Chest", equipment: "Machine", type: "strength", target_sets: 3, target_reps: "8-12" },
  { name: "Pec Deck Fly", muscle_group: "Chest", equipment: "Machine", type: "strength", target_sets: 3, target_reps: "10-15" },
  { name: "Cable Fly (low to high)", muscle_group: "Upper chest", equipment: "Cable", type: "strength", target_sets: 3, target_reps: "12-15" },
  { name: "Dumbbell Lateral Raise", muscle_group: "Side delts", equipment: "Dumbbell", type: "strength", target_sets: 3, target_reps: "12-20" },
  { name: "Triceps Pushdown", muscle_group: "Triceps", equipment: "Cable", type: "strength", target_sets: 3, target_reps: "10-15" },
  { name: "Stair Master", muscle_group: "Cardio", equipment: "Machine", type: "cardio", target_sets: 1, target_reps: null },
];

/** Create the first regime + the Monday chest routine. */
export async function seedStarter(sb: SupabaseClient, regimeName = "Regime 1"): Promise<void> {
  const regime = await createInitialRegime(sb, regimeName);
  const monday = await createRoutine(sb, regime.id, "Chest", 1 /* Monday */, 0);
  for (let i = 0; i < MONDAY.length; i++) {
    const e = MONDAY[i];
    const exercise = await findOrCreateExercise(sb, {
      name: e.name,
      muscle_group: e.muscle_group,
      equipment: e.equipment,
      type: e.type,
    });
    await addRoutineExercise(sb, monday.id, exercise.id, i, e.target_sets, e.target_reps);
  }
}

/** Create an empty active regime (no routines). */
export async function createBlankRegime(sb: SupabaseClient, name = "Regime 1"): Promise<void> {
  await createInitialRegime(sb, name);
}

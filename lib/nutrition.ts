import type { MealWithItems } from "./types";

export interface MacroTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export const EMPTY_MACROS: MacroTotals = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
};

/** Sum item-level nutrition; the item rows remain the source of truth. */
export function mealMacros(meals: MealWithItems[]): MacroTotals {
  const totals = meals.flatMap((meal) => meal.meal_items).reduce(
    (sum, item) => ({
      calories: sum.calories + Number(item.calories),
      protein_g: sum.protein_g + Number(item.protein_g),
      carbs_g: sum.carbs_g + Number(item.carbs_g),
      fat_g: sum.fat_g + Number(item.fat_g),
    }),
    { ...EMPTY_MACROS },
  );
  return {
    calories: Math.round(totals.calories),
    protein_g: Math.round(totals.protein_g * 10) / 10,
    carbs_g: Math.round(totals.carbs_g * 10) / 10,
    fat_g: Math.round(totals.fat_g * 10) / 10,
  };
}

import type { MealWithItems } from "./types";

export type MealResearchJobStatus = "queued" | "running" | "retry_wait" | "succeeded" | "needs_review" | "discarded";

export interface MealResearchJob {
  id: string;
  logged_on: string;
  original_input: string;
  status: MealResearchJobStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  draft_analysis: unknown | null;
  last_error_message: string | null;
  result_meal_id: string | null;
  created_at: string;
}

export interface ReusableMeal {
  id: string;
  name: string;
  meal_type: string;
  nutrition_status: "legacy" | "confirmed" | "estimate";
  revision: number;
  items: Array<Record<string, unknown>>;
  updated_at: string;
}

export function retryDelaySeconds(attempt: number, random: () => number = Math.random): number {
  const cap = 30 * 60;
  const ceiling = Math.min(cap, 30 * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.floor(random() * ceiling));
}

export function reusableMatches(input: string, templates: ReusableMeal[]): ReusableMeal[] {
  const terms = input.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  return templates
    .map((template) => ({ template, score: terms.filter((term) => template.name.toLocaleLowerCase().includes(term)).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name))
    .map(({ template }) => template);
}

export function yesterdayMealMatches(meals: MealWithItems[], referenceDate: string, mealType: string): MealWithItems[] {
  return meals.filter((meal) => meal.logged_on === referenceDate && meal.meal_type === mealType);
}

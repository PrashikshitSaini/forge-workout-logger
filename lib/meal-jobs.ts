export interface ReusableMeal {
  id: string;
  name: string;
  meal_type: string;
  nutrition_status: "legacy" | "confirmed" | "estimate";
  revision: number;
  items: Array<Record<string, unknown>>;
  updated_at: string;
}

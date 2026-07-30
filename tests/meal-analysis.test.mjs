import assert from "node:assert/strict";
import test from "node:test";
import { MealAnalysisSchema } from "../lib/meal-analysis.ts";

test("accepts a practical multi-item meal estimate when exact label evidence is unavailable", () => {
  const result = MealAnalysisSchema.parse({
    title: "Pasta with cottage cheese and peppers",
    meal_type: "lunch",
    assumptions: ["Cottage cheese treated as Great Value 1% low-fat."],
    items: [
      { name: "Elbow pasta, dry", brand: "Barilla", quantity: "100 g", calories: 357, protein_g: 12.5, carbs_g: 75, fat_g: 1.8, fiber_g: 3, source_url: null, source_title: null, confidence: "low" },
      { name: "Olive oil", brand: null, quantity: "1 tbsp", calories: 119, protein_g: 0, carbs_g: 0, fat_g: 13.5, fiber_g: 0, source_url: null, source_title: null, confidence: "low" },
      { name: "Cottage cheese", brand: "Great Value", quantity: "100 g", calories: 71, protein_g: 10.6, carbs_g: 5.3, fat_g: 0.9, fiber_g: 0, source_url: null, source_title: null, confidence: "low" },
      { name: "Red bell pepper", brand: null, quantity: "1 tbsp", calories: 3, protein_g: 0.1, carbs_g: 0.5, fat_g: 0, fiber_g: 0.2, source_url: null, source_title: null, confidence: "low" },
    ],
  });

  assert.equal(result.items.length, 4);
  assert.equal(result.items.reduce((total, item) => total + item.calories, 0), 550);
});

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

test("tolerates common nutrition-response omissions and numeric strings", () => {
  const result = MealAnalysisSchema.parse({
    title: "Pasta and cottage cheese",
    meal_type: "lunch",
    items: [
      {
        name: "Elbow pasta",
        brand: "Barilla",
        quantity: "100 g",
        calories: "357",
        protein_g: "12.5",
        carbs_g: 75,
        fat_g: 1.8,
      },
    ],
  });

  assert.deepEqual(result.assumptions, []);
  assert.equal(result.items[0].fiber_g, null);
  assert.equal(result.items[0].source_url, null);
  assert.equal(result.items[0].confidence, "low");
  assert.equal(result.items[0].calories, 357);
});

test("defaults omitted nullable item fields", () => {
  const [item] = MealAnalysisSchema.parse({
    title: "Simple lunch",
    meal_type: "lunch",
    items: [{
      name: "White bread",
      quantity: "2 slices",
      calories: 140,
      protein_g: 5,
      carbs_g: 26,
      fat_g: 2,
    }],
  }).items;

  assert.equal(item.brand, null);
  assert.equal(item.fiber_g, null);
  assert.equal(item.source_url, null);
  assert.equal(item.source_title, null);
  assert.equal(item.confidence, "low");
});

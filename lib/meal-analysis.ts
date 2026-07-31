import { z } from "zod";

const numberField = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value === "string") {
        const parsed = Number(value.replaceAll(",", "").trim());
        return Number.isFinite(parsed) ? parsed : value;
      }
      return value;
    },
    z.number().min(0).max(max),
  );

const nullableNumberField = (max: number) =>
  z.preprocess(
    (value) => {
      if (value == null || value === "") return null;
      if (typeof value === "string") {
        const parsed = Number(value.replaceAll(",", "").trim());
        return Number.isFinite(parsed) ? parsed : value;
      }
      return value;
    },
    z.number().min(0).max(max).nullable().default(null),
  );

const nullableStringField = (max: number) =>
  z.preprocess(
    (value) => (value == null || value === "" ? null : value),
    z.string().trim().min(1).max(max).nullable().default(null),
  );

export const MealItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brand: nullableStringField(120),
  quantity: z.string().trim().min(1).max(120),
  calories: numberField(100_000),
  protein_g: numberField(10_000),
  carbs_g: numberField(10_000),
  fat_g: numberField(10_000),
  // Nutrition responses often omit fiber or return it as a numeric string.
  fiber_g: nullableNumberField(10_000),
  source_url: nullableStringField(2_000).refine(
    (value) => value == null || /^https?:\/\//i.test(value),
    "source_url must be an http(s) URL",
  ),
  source_title: nullableStringField(240),
  confidence: z.enum(["high", "medium", "low"]).default("low"),
});

export const MealAnalysisSchema = z.object({
  title: z.string().trim().min(1).max(120),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "meal"]),
  assumptions: z.array(z.string().trim().min(1).max(240)).default([]),
  items: z.array(MealItemSchema).min(1).max(30),
});

export type MealItem = z.infer<typeof MealItemSchema>;

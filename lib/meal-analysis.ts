import { z } from "zod";

export const MealItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().min(1).max(120).nullable(),
  quantity: z.string().trim().min(1).max(120),
  calories: z.number().min(0).max(100_000),
  protein_g: z.number().min(0).max(10_000),
  carbs_g: z.number().min(0).max(10_000),
  fat_g: z.number().min(0).max(10_000),
  fiber_g: z.number().min(0).max(10_000).nullable(),
  source_url: z.string().url().max(2_000).nullable(),
  source_title: z.string().trim().min(1).max(240).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

export const MealAnalysisSchema = z.object({
  title: z.string().trim().min(1).max(120),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "meal"]),
  assumptions: z.array(z.string().trim().min(1).max(240)).max(12),
  items: z.array(MealItemSchema).min(1).max(30),
});

export type MealItem = z.infer<typeof MealItemSchema>;

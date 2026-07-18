import { z } from "zod";

const LabelMacrosSchema = z.object({
  calories: z.number().min(0).max(10_000),
  protein_g: z.number().min(0).max(1_000),
  carbs_g: z.number().min(0).max(1_000),
  fat_g: z.number().min(0).max(1_000),
  fiber_g: z.number().min(0).max(1_000).nullable(),
});

const ServingUnitSchema = z.enum([
  "g",
  "ml",
  "oz",
  "cup",
  "tbsp",
  "tsp",
  "piece",
  "slice",
  "container",
  "package",
  "serving",
]);

export const ResearchItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().min(1).max(120).nullable(),
  quantity: z.string().trim().min(1).max(120),
  source_serving: z.string().trim().min(1).max(160),
  consumed_amount: z.number().positive().max(100_000),
  consumed_unit: ServingUnitSchema,
  source_amount: z.number().positive().max(100_000),
  source_unit: ServingUnitSchema,
  label: LabelMacrosSchema,
  source_url: z.string().url().max(2_000),
  source_title: z.string().trim().min(1).max(240),
  evidence: z.string().trim().min(12).max(1_200),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ResearchAnalysisSchema = z.object({
  title: z.string().trim().min(1).max(120),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "meal"]),
  assumptions: z.array(z.string().trim().min(1).max(240)).max(12),
  items: z.array(ResearchItemSchema).min(1).max(30),
});

export type ResearchItem = z.infer<typeof ResearchItemSchema>;
export type ResearchAnalysis = z.infer<typeof ResearchAnalysisSchema>;

export interface NutritionCitation {
  url: string;
  title: string;
  content: string;
}

export interface VerifiedMealItem {
  name: string;
  brand: string | null;
  quantity: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  source_url: string;
  source_title: string;
  confidence: "high" | "medium" | "low";
}

export class NutritionVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NutritionVerificationError";
  }
}

function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLocaleLowerCase().replace(/^www\./, "");
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "").toLocaleLowerCase();
    return `${host}${path || "/"}`;
  } catch {
    return null;
  }
}

function normalizeEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\[\.\.\.\]/g, " ")
    .replace(/[^\p{L}\p{N}.%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceIsQuoted(evidence: string, sourceContent: string): boolean {
  const quote = normalizeEvidence(evidence);
  const source = normalizeEvidence(sourceContent);
  if (quote.length < 12 || source.length < 12) return false;
  if (source.includes(quote)) return true;

  // Search excerpts occasionally insert/remove punctuation or ellipsis markers.
  // Require near-total token overlap so a paraphrase cannot pass as a quote.
  const tokens = quote.split(" ").filter((token) => token.length > 1);
  if (tokens.length < 6) return false;
  const sourceTokens = new Set(source.split(" "));
  const matched = tokens.filter((token) => sourceTokens.has(token)).length;
  return matched / tokens.length >= 0.9;
}

function numbersIn(value: string): number[] {
  const tokens = value.match(/\d[\d,]*(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/g) ?? [];
  return tokens.flatMap((token) => {
    const normalized = token.replaceAll(",", "").replaceAll(" ", "");
    if (!normalized.includes("/")) {
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? [parsed] : [];
    }
    const [numerator, denominator] = normalized.split("/").map(Number);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
      ? [numerator / denominator]
      : [];
  });
}

function numericFactAppears(value: number, evidence: string, tolerance: number): boolean {
  if (value === 0) return true;
  return numbersIn(evidence).some((parsed) => Math.abs(parsed - value) <= tolerance);
}

function servingUnitAppears(unit: ResearchItem["source_unit"], evidence: string): boolean {
  const aliases: Record<ResearchItem["source_unit"], string[]> = {
    g: ["g", "gram", "grams"],
    ml: ["ml", "milliliter", "milliliters"],
    oz: ["oz", "ounce", "ounces"],
    cup: ["cup", "cups"],
    tbsp: ["tbsp", "tablespoon", "tablespoons"],
    tsp: ["tsp", "teaspoon", "teaspoons"],
    piece: ["piece", "pieces"],
    slice: ["slice", "slices"],
    container: ["container", "containers"],
    package: ["package", "packages", "pkg"],
    serving: ["serving", "servings"],
  };
  const tokens = new Set(
    normalizeEvidence(evidence)
      .replace(/(?<=\d)(?=\p{L})|(?<=\p{L})(?=\d)/gu, " ")
      .split(" "),
  );
  return aliases[unit].some((alias) => tokens.has(alias));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function findCitation(sourceUrl: string, citations: NutritionCitation[]): NutritionCitation | null {
  const wanted = canonicalUrl(sourceUrl);
  if (!wanted) return null;
  return citations.find((citation) => canonicalUrl(citation.url) === wanted) ?? null;
}

/**
 * Convert researched per-serving label facts into the exact consumed macros.
 * Nothing reaches the database unless its source URL and quoted nutrition facts
 * are present in OpenRouter's actual web-search citations.
 */
export function verifyAndScaleItem(
  item: ResearchItem,
  citations: NutritionCitation[],
): VerifiedMealItem {
  const citation = findCitation(item.source_url, citations);
  if (!citation?.content) {
    throw new NutritionVerificationError(`No search evidence was returned for ${item.name}.`);
  }
  if (!evidenceIsQuoted(item.evidence, citation.content)) {
    throw new NutritionVerificationError(`The cited label evidence could not be verified for ${item.name}.`);
  }

  const facts: Array<[number, number]> = [
    [item.label.calories, 2],
    [item.label.protein_g, 0.6],
    [item.label.carbs_g, 0.6],
    [item.label.fat_g, 0.6],
  ];
  if (!facts.every(([value, tolerance]) => numericFactAppears(value, item.evidence, tolerance))) {
    throw new NutritionVerificationError(`The source excerpt does not support all macros for ${item.name}.`);
  }
  if (!numericFactAppears(item.source_amount, item.evidence, 0.02)) {
    throw new NutritionVerificationError(`The source serving amount is not supported for ${item.name}.`);
  }
  if (!servingUnitAppears(item.source_unit, item.evidence)) {
    throw new NutritionVerificationError(`The source serving unit is not supported for ${item.name}.`);
  }
  if (item.consumed_unit !== item.source_unit) {
    throw new NutritionVerificationError(`The serving units cannot be verified for ${item.name}.`);
  }

  // Nutrition labels legitimately differ from 4/4/9 math because of rounding,
  // fiber, and sugar alcohols. This deliberately wide bound only rejects major
  // extraction mistakes (wrong serving/column/product), not normal label noise.
  const macroCalories =
    item.label.protein_g * 4 + item.label.carbs_g * 4 + item.label.fat_g * 9;
  const calorieGap = Math.abs(item.label.calories - macroCalories);
  if (item.label.calories >= 20 && calorieGap > Math.max(45, item.label.calories * 0.4)) {
    throw new NutritionVerificationError(`The label macros are internally inconsistent for ${item.name}.`);
  }

  const scale = item.consumed_amount / item.source_amount;
  const verified: VerifiedMealItem = {
    name: item.name,
    brand: item.brand,
    quantity: item.quantity,
    calories: round(item.label.calories * scale),
    protein_g: round(item.label.protein_g * scale),
    carbs_g: round(item.label.carbs_g * scale),
    fat_g: round(item.label.fat_g * scale),
    fiber_g: item.label.fiber_g == null ? null : round(item.label.fiber_g * scale),
    source_url: citation.url,
    source_title: citation.title || item.source_title,
    confidence: item.confidence,
  };

  if (
    verified.calories > 100_000 ||
    verified.protein_g > 10_000 ||
    verified.carbs_g > 10_000 ||
    verified.fat_g > 10_000 ||
    (verified.fiber_g != null && verified.fiber_g > 10_000)
  ) {
    throw new NutritionVerificationError(`The serving conversion is implausible for ${item.name}.`);
  }

  return verified;
}

export function verifyAndScaleAnalysis(
  analysis: ResearchAnalysis,
  citations: NutritionCitation[],
): VerifiedMealItem[] {
  if (citations.length === 0) {
    throw new NutritionVerificationError("The nutrition search returned no citable sources.");
  }
  return analysis.items.map((item) => verifyAndScaleItem(item, citations));
}

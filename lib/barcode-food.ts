import { z } from "zod";

/**
 * Barcode meal logging — pure helpers (no DOM, no Supabase) so `node:test` can
 * import this file directly. The Open Food Facts lookup lives in the route; this
 * module only validates, normalizes and scales what that route receives.
 */

const SOURCE_TITLE = "Open Food Facts";
const SOURCE_URL_BASE = "https://world.openfoodfacts.org/product/";
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const REQUIRED_MACROS = ["calories", "protein_g", "carbs_g", "fat_g"] as const;

export type MacroKey = (typeof REQUIRED_MACROS)[number];

export const MACRO_LABELS: Record<MacroKey, string> = {
  calories: "calories",
  protein_g: "protein",
  carbs_g: "carbs",
  fat_g: "fat",
};

export interface BarcodeNutrition {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
}

export interface BarcodeProduct {
  barcode: string;
  name: string;
  brand: string | null;
  packageQuantity: string | null;
  basis: "serving" | "100g" | "100ml";
  basisLabel: string;
  basisAmount: number;
  unit: "g" | "ml" | "serving";
  /** The label's own serving text ("2 slices (56 g)") when OFF reports one. */
  servingText: string | null;
  /** OFF's computed per-serving values when the chosen basis is a per-100 one. */
  servingNutrition: BarcodeNutrition | null;
  quantitySuggestion: string;
  nutrition: BarcodeNutrition;
  /** Required macros the label data did not provide. Null ≠ 0: these need a human value. */
  missing: MacroKey[];
  note: string | null;
  sourceUrl: string;
  sourceTitle: string;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function numberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

/** OFF `brands` can be "Nutella, Ferrero"; the first entry reads best in a meal title. */
function brandText(value: unknown): string | null {
  const text = firstText(value)?.split(",")[0]?.trim();
  return text ? text.slice(0, 120) : null;
}

/* ── Barcode validation ──────────────────────────────────────────────────── */

/** Standard GTIN mod-10 check digit (EAN-13, UPC-A, GTIN-14, EAN-8). */
export function hasValidGtinCheckDigit(digits: string): boolean {
  if (!/^\d{8,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const fromRight = body.length - index;
    sum += Number(body[index]) * (fromRight % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * Strip separators and validate a numeric UPC/EAN.
 * 8-digit codes are accepted as either EAN-8 or UPC-E (a UPC-E check digit is
 * derived from its expanded UPC-A, so it cannot be verified from 8 digits alone).
 */
export function normalizeBarcode(raw: string | null | undefined): string | null {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  if (!GTIN_LENGTHS.has(digits.length)) return null;
  if (digits.length !== 8 && !hasValidGtinCheckDigit(digits)) return null;
  return digits;
}

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Real calendar date, not just a well-shaped string (rejects 2026-02-31). */
export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/* ── Open Food Facts normalization ───────────────────────────────────────── */

/**
 * OFF always stores its per-100 values under the `_100g` suffix, even for
 * liquids, where those values are per 100 ml. `_100ml` keys do not exist.
 * @see https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/
 */
const HUNDRED_SUFFIX = "100g";
const SERVING_SUFFIX = "serving";

function readMacro(
  nutriments: Record<string, unknown>,
  key: string,
  suffix: string,
): number | null {
  return toNumber(nutriments[`${key}_${suffix}`]);
}

/** Prefer kcal; convert kJ (÷4.184) only when the label lists energy as kJ. */
function readEnergyKcal(nutriments: Record<string, unknown>, suffix: string): number | null {
  const kcal = toNumber(
    nutriments[`energy-kcal_${suffix}`] ?? nutriments[`energy-kcal_${suffix}_value`],
  );
  if (kcal !== null) return kcal;
  const kj = toNumber(nutriments[`energy-kj_${suffix}`] ?? nutriments[`energy_${suffix}`]);
  return kj === null ? null : round1(kj / 4.184);
}

function readNutrition(nutriments: Record<string, unknown>, suffix: string): BarcodeNutrition {
  return {
    calories: readEnergyKcal(nutriments, suffix),
    protein_g: readMacro(nutriments, "proteins", suffix),
    carbs_g: readMacro(nutriments, "carbohydrates", suffix),
    fat_g: readMacro(nutriments, "fat", suffix),
    fiber_g: readMacro(nutriments, "fiber", suffix),
  };
}

function hasNutrition(nutrition: BarcodeNutrition): boolean {
  return REQUIRED_MACROS.some((key) => nutrition[key] !== null);
}

/** Estimate energy from macros only when the label truly lists no energy value. */
function withEstimatedCalories(nutrition: BarcodeNutrition): {
  nutrition: BarcodeNutrition;
  estimated: boolean;
} {
  if (
    nutrition.calories === null &&
    nutrition.protein_g !== null &&
    nutrition.carbs_g !== null &&
    nutrition.fat_g !== null
  ) {
    return {
      nutrition: {
        ...nutrition,
        calories: round1(4 * nutrition.protein_g + 4 * nutrition.carbs_g + 9 * nutrition.fat_g),
      },
      estimated: true,
    };
  }
  return { nutrition, estimated: false };
}

/** OFF's own serving text: the label's `serving_size`, else the computed quantity. */
function servingText(product: Record<string, unknown>): string | null {
  const size = firstText(product.serving_size);
  if (size) return size;
  const quantity = toNumber(product.serving_quantity);
  if (quantity === null) return null;
  const unit = firstText(product.serving_quantity_unit) ?? firstText(product.product_quantity_unit);
  return unit ? `${quantity} ${unit}` : String(quantity);
}

/**
 * Turn an Open Food Facts v2 payload into an honest, editable product.
 * Keeps the label's own basis (serving, or 100 g / 100 ml) instead of inferring
 * pieces or converting between mass and volume. The basis unit comes from OFF's
 * declared `nutrition_data_per`, its `*_quantity_unit` metadata or `nutrition_data_per: 100ml`;
 * density is never assumed.
 */
export function parseBarcodeProduct(barcode: string, raw: unknown): BarcodeProduct {
  const product = ((raw as { product?: unknown } | null)?.product ?? {}) as Record<string, unknown>;
  const nutriments = (product.nutriments ?? {}) as Record<string, unknown>;
  const declaredPer = firstText(product.nutrition_data_per);
  const quantityUnit = firstText(product.product_quantity_unit);
  const servingUnit = firstText(product.serving_quantity_unit);
  const liquid = quantityUnit === "ml" || servingUnit === "ml";

  const perHundred = readNutrition(nutriments, HUNDRED_SUFFIX);
  const perServing = readNutrition(nutriments, SERVING_SUFFIX);
  const hasHundred = hasNutrition(perHundred);
  const hasServing = hasNutrition(perServing);

  // OFF's *_100g values are per 100 g, or per 100 ml for liquids; the suffix never changes.
  const hundredBasis: BarcodeProduct["basis"] =
    declaredPer === "100ml" || liquid ? "100ml" : "100g";
  const hundredUnit: "g" | "ml" = hundredBasis === "100ml" ? "ml" : "g";

  const basis: BarcodeProduct["basis"] =
    (declaredPer === "serving" && hasServing) || (!hasHundred && hasServing)
      ? "serving"
      : hundredBasis;

  const baseNutrition = withEstimatedCalories(basis === "serving" ? perServing : perHundred);
  const nutrition = baseNutrition.nutrition;

  // Offer the label's own serving as a second basis when OFF computed one.
  const extraServing = basis !== "serving" && hasServing ? withEstimatedCalories(perServing) : null;

  const labelServingText = servingText(product);
  const servingLabel = `1 serving${labelServingText ? ` (${labelServingText})` : ""}`;
  const basisAmount = basis === "serving" ? 1 : 100;
  const unit: BarcodeProduct["unit"] = basis === "serving" ? "serving" : hundredUnit;
  const basisLabel = basis === "serving" ? servingLabel : `per 100 ${hundredUnit}`;

  const missing = REQUIRED_MACROS.filter((key) => nutrition[key] === null);

  const notes: string[] = [];
  if (missing.length && product.no_nutrition_data) {
    notes.push("Open Food Facts has no nutrition data for this product; enter it from the label.");
  }
  if (baseNutrition.estimated) {
    notes.push("Calories estimated from the label macros because energy was not listed.");
  }
  if (basis === "100ml" && declaredPer !== "100ml") {
    notes.push("Open Food Facts records this liquid per 100 ml.");
  }

  return {
    barcode,
    name:
      firstText(product.product_name) ??
      firstText(product.product_name_en) ??
      firstText(product.generic_name) ??
      `Barcode ${barcode}`,
    brand: brandText(product.brands),
    packageQuantity: firstText(product.quantity),
    basis,
    basisLabel,
    basisAmount,
    unit,
    servingText: labelServingText,
    servingNutrition: extraServing ? extraServing.nutrition : null,
    quantitySuggestion: basis === "serving" ? servingLabel : `100 ${unit}`,
    nutrition,
    missing,
    note: notes.length ? notes.join(" ") : null,
    sourceUrl: `${SOURCE_URL_BASE}${barcode}`,
    sourceTitle: SOURCE_TITLE,
  };
}

/* ── Scaling + save payload ──────────────────────────────────────────────── */

export function scaleNutrition(nutrition: BarcodeNutrition, factor: number): BarcodeNutrition {
  const scale = (value: number | null) => (value === null ? null : round1(value * factor));
  return {
    calories: scale(nutrition.calories),
    protein_g: scale(nutrition.protein_g),
    carbs_g: scale(nutrition.carbs_g),
    fat_g: scale(nutrition.fat_g),
    fiber_g: scale(nutrition.fiber_g),
  };
}

const numberField = (max: number) =>
  z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) return value;
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.number().finite().min(0).max(max));

const positiveNumberField = z.preprocess((value) => {
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().finite().gt(0).max(100_000));

export const BarcodeSaveSchema = z.object({
  barcode: z.string().trim().min(1).max(24),
  logged_on: z.string().refine(isRealDate, "Choose a real calendar date."),
  name: z.string().trim().min(1).max(160),
  brand: z.preprocess(
    (value) => (value == null || value === "" ? null : value),
    z.string().trim().min(1).max(120).nullable().default(null),
  ),
  // The basis the user reviewed: "per 100 g", "1 serving (2 slices)", a custom "1 slice"…
  basis_label: z.string().trim().min(1).max(120),
  basis_amount: positiveNumberField,
  amount: positiveNumberField,
  quantity: z.string().trim().min(1).max(120),
  calories: numberField(100_000),
  protein_g: numberField(10_000),
  carbs_g: numberField(10_000),
  fat_g: numberField(10_000),
  fiber_g: z.preprocess(
    (value) => (value == null || value === "" ? null : value),
    z.number().finite().min(0).max(10_000).nullable().default(null),
  ),
});

export type BarcodeSaveInput = z.infer<typeof BarcodeSaveSchema>;

export const MAX_SCALE_FACTOR = 1000;

export interface BarcodeMealDraft {
  barcode: string;
  title: string;
  item: {
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
    confidence: "medium";
  };
  assumptions: string[];
  factor: number;
  nutrition: BarcodeNutrition;
}

/**
 * Compute the saved meal item server-side from the reviewed label values.
 * The client may edit everything, so this is confidence "medium" (user-reviewed
 * label data, not a manufacturer-verified record) with a short note of basis.
 */
export function buildBarcodeMeal(input: BarcodeSaveInput): BarcodeMealDraft {
  const barcode = normalizeBarcode(input.barcode);
  if (!barcode) throw new Error("Enter a valid UPC/EAN barcode (8, 12, 13, or 14 digits).");

  const factor = input.amount / input.basis_amount;
  if (!Number.isFinite(factor) || factor <= 0 || factor > MAX_SCALE_FACTOR) {
    throw new Error("Enter a realistic amount eaten and the amount your label values cover.");
  }

  const nutrition = scaleNutrition(
    {
      calories: input.calories,
      protein_g: input.protein_g,
      carbs_g: input.carbs_g,
      fat_g: input.fat_g,
      fiber_g: input.fiber_g,
    },
    factor,
  );

  const title = `${input.brand ? `${input.brand} ` : ""}${input.name}`.trim().slice(0, 120);
  const assumption =
    `Barcode ${barcode} on Open Food Facts; macros are the reviewed label values ${input.basis_label}, scaled ×${round2(factor)}. Not manufacturer-verified.`.slice(
      0,
      240,
    );

  return {
    barcode,
    title,
    factor,
    nutrition,
    assumptions: [assumption],
    item: {
      name: input.name,
      brand: input.brand,
      quantity: input.quantity,
      calories: nutrition.calories ?? 0,
      protein_g: nutrition.protein_g ?? 0,
      carbs_g: nutrition.carbs_g ?? 0,
      fat_g: nutrition.fat_g ?? 0,
      fiber_g: nutrition.fiber_g,
      source_url: `${SOURCE_URL_BASE}${barcode}`,
      source_title: SOURCE_TITLE,
      confidence: "medium",
    },
  };
}

/* ── Open Food Facts response mapping (route) ────────────────────────────── */

export type OffLookupOutcome = "product" | "not_found" | "unavailable";

/**
 * Map an OFF HTTP status + JSON body to a lookup outcome. OFF returns 404 for an
 * unknown barcode, so that must be a product-not-found, not a server error.
 */
export function offLookupOutcome(httpStatus: number, payload: unknown): OffLookupOutcome {
  if (httpStatus === 404) return "not_found";
  if (httpStatus < 200 || httpStatus >= 300) return "unavailable";
  const body = (payload ?? {}) as { status?: unknown; product?: unknown };
  if (body.status === 0 || body.status === "failure" || !body.product) return "not_found";
  return "product";
}

/* ── Editable draft (shared by the UI and its regression tests) ──────────── */

export type BasisMode = "label" | "serving" | "piece";
export type BasisUnit = "g" | "ml" | "serving" | "piece";

export interface NutritionFields {
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
}

export const EMPTY_NUTRITION: NutritionFields = {
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  fiber: "",
};

export interface BarcodeDraft {
  barcode: string;
  name: string;
  brand: string;
  sourceUrl: string;
  sourceTitle: string;
  note: string | null;
  missing: MacroKey[];
  productBasis: BarcodeProduct["basis"];
  productBasisLabel: string;
  productNutrition: NutritionFields;
  servingText: string | null;
  servingNutrition: NutritionFields | null;
  /** How the values below are expressed. Drives basis amount and unit exactly. */
  mode: BasisMode;
  /** Cosmetic name of one piece ("slice"). Never changes the units or the maths. */
  pieceName: string;
  nutrition: NutritionFields;
  amount: string;
  quantity: string;
}

export interface ResolvedBasis {
  amount: number;
  unit: BasisUnit;
  /** What the label values cover, e.g. "per 100 g" or "1 serving (2 slices (56 g))". */
  label: string;
  /** Unit shown beside the amount eaten, e.g. "g", "servings", "slice". */
  unitLabel: string;
}

function numberText(value: number | null): string {
  return value === null ? "" : String(value);
}

function nutritionFields(nutrition: BarcodeNutrition): NutritionFields {
  return {
    calories: numberText(nutrition.calories),
    protein: numberText(nutrition.protein_g),
    carbs: numberText(nutrition.carbs_g),
    fat: numberText(nutrition.fat_g),
    fiber: numberText(nutrition.fiber_g),
  };
}

export function draftFromProduct(product: BarcodeProduct): BarcodeDraft {
  const productNutrition = nutritionFields(product.nutrition);
  return {
    barcode: product.barcode,
    name: product.name,
    brand: product.brand ?? "",
    sourceUrl: product.sourceUrl,
    sourceTitle: product.sourceTitle,
    note: product.note,
    missing: product.missing,
    productBasis: product.basis,
    productBasisLabel: product.basisLabel,
    productNutrition,
    servingText: product.servingText,
    servingNutrition: product.servingNutrition ? nutritionFields(product.servingNutrition) : null,
    mode: "label",
    pieceName: "piece",
    nutrition: productNutrition,
    amount: String(product.basisAmount),
    quantity: product.quantitySuggestion,
  };
}

/** Modes the user may switch between for this product. */
export function availableModes(draft: BarcodeDraft): BasisMode[] {
  const modes: BasisMode[] = ["label"];
  if (draft.productBasis !== "serving" && draft.servingNutrition) modes.push("serving");
  modes.push("piece");
  return modes;
}

/** The exact basis (amount + unit) for the current mode. Cosmetic text never feeds this. */
export function resolveBasis(draft: BarcodeDraft): ResolvedBasis {
  if (draft.mode === "serving") {
    const text = draft.servingText ? ` (${draft.servingText})` : "";
    return { amount: 1, unit: "serving", label: `1 serving${text}`, unitLabel: "serving" };
  }
  if (draft.mode === "piece") {
    const name = draft.pieceName.trim() || "piece";
    return { amount: 1, unit: "piece", label: `1 ${name}`, unitLabel: name };
  }
  if (draft.productBasis === "serving") {
    return { amount: 1, unit: "serving", label: draft.productBasisLabel, unitLabel: "serving" };
  }
  const unit: "g" | "ml" = draft.productBasis === "100ml" ? "ml" : "g";
  return { amount: 100, unit, label: `per 100 ${unit}`, unitLabel: unit };
}

function quantityNoun(basis: ResolvedBasis, count: number): string {
  if (basis.unit === "g" || basis.unit === "ml") return basis.unit;
  return count === 1 ? basis.unitLabel : `${basis.unitLabel}s`;
}

/** "4 slices", "150 g", "2 servings" — the editable default for the quantity field. */
export function quantityForAmount(draft: BarcodeDraft, amount: string): string {
  const parsed = numberOrNull(amount);
  if (parsed === null) return "";
  const basis = resolveBasis(draft);
  return `${parsed} ${quantityNoun(basis, parsed)}`;
}

/**
 * Switch how the label values are expressed. Values only carry across when the
 * printed basis is unchanged; moving to "per piece" (or an added serving basis)
 * blanks them so the user re-enters what that basis actually says rather than
 * silently re-scaling per-100 numbers.
 */
export function setBasisMode(draft: BarcodeDraft, mode: BasisMode): BarcodeDraft {
  if (draft.mode === mode || !availableModes(draft).includes(mode)) return draft;
  const next: BarcodeDraft = { ...draft, mode };
  next.nutrition =
    mode === "label"
      ? draft.productNutrition
      : mode === "serving"
        ? draft.servingNutrition ?? EMPTY_NUTRITION
        : EMPTY_NUTRITION;
  const basis = resolveBasis(next);
  next.amount = String(basis.amount);
  next.quantity = `${basis.amount} ${quantityNoun(basis, basis.amount)}`;
  return next;
}

/**
 * Rename the cosmetic piece. When the quantity is still the auto-generated
 * default ("4 pieces") it follows the new name ("4 slices"); a quantity the
 * user typed is left untouched.
 */
export function setPieceName(draft: BarcodeDraft, pieceName: string): BarcodeDraft {
  const next: BarcodeDraft = { ...draft, pieceName };
  if (draft.quantity === quantityForAmount(draft, draft.amount)) {
    next.quantity = quantityForAmount(next, next.amount);
  }
  return next;
}

export function draftFactor(draft: BarcodeDraft): number {
  const basis = resolveBasis(draft);
  const amount = numberOrNull(draft.amount);
  if (amount === null || amount <= 0) return 0;
  return amount / basis.amount;
}

/**
 * Scaled totals for the reviewed amount, or null when it is unusable (blank,
 * zero, non-finite). Null renders as dashes and, crucially, keeps the editor
 * open instead of hiding it and stranding the draft.
 */
export function draftTotals(draft: BarcodeDraft): BarcodeNutrition | null {
  const factor = draftFactor(draft);
  return factor > 0 ? scaleNutrition(draftNutritionNumbers(draft), factor) : null;
}

/** The client save gate: the exact schema (and bounds) the route re-validates. */
export function canSaveDraft(draft: BarcodeDraft, loggedOn: string): boolean {
  return BarcodeSaveSchema.safeParse(draftToSavePayload(draft, loggedOn)).success;
}

export function draftNutritionNumbers(draft: BarcodeDraft): BarcodeNutrition {
  return {
    calories: numberOrNull(draft.nutrition.calories),
    protein_g: numberOrNull(draft.nutrition.protein),
    carbs_g: numberOrNull(draft.nutrition.carbs),
    fat_g: numberOrNull(draft.nutrition.fat),
    fiber_g: numberOrNull(draft.nutrition.fiber),
  };
}

export function draftMissingRequired(draft: BarcodeDraft): MacroKey[] {
  const nutrition = draftNutritionNumbers(draft);
  return REQUIRED_MACROS.filter((key) => nutrition[key] === null);
}

/** JSON body the client posts; the route validates it against BarcodeSaveSchema. */
export interface BarcodeSavePayload {
  barcode: string;
  logged_on: string;
  name: string;
  brand: string | null;
  basis_label: string;
  basis_amount: number;
  amount: number | null;
  quantity: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
}

export function draftToSavePayload(draft: BarcodeDraft, loggedOn: string): BarcodeSavePayload {
  const basis = resolveBasis(draft);
  const nutrition = draftNutritionNumbers(draft);
  return {
    barcode: draft.barcode,
    logged_on: loggedOn,
    name: draft.name.trim(),
    brand: draft.brand.trim() || null,
    basis_label: basis.label,
    basis_amount: basis.amount,
    amount: numberOrNull(draft.amount),
    quantity: draft.quantity.trim(),
    calories: nutrition.calories,
    protein_g: nutrition.protein_g,
    carbs_g: nutrition.carbs_g,
    fat_g: nutrition.fat_g,
    fiber_g: nutrition.fiber_g,
  };
}

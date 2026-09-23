import assert from "node:assert/strict";
import test from "node:test";
import {
  BarcodeSaveSchema,
  availableModes,
  buildBarcodeMeal,
  canSaveDraft,
  draftFromProduct,
  draftMissingRequired,
  draftTotals,
  draftToSavePayload,
  isRealDate,
  normalizeBarcode,
  offLookupOutcome,
  parseBarcodeProduct,
  quantityForAmount,
  resolveBasis,
  scaleNutrition,
  setBasisMode,
  setPieceName,
} from "../lib/barcode-food.ts";

const PRODUCT_BASE = {
  barcode: "3017620422003",
  logged_on: "2026-01-15",
  name: "Nutella",
  brand: "Ferrero",
  basis_label: "per 100 g",
  basis_amount: 100,
  amount: 100,
  quantity: "100 g",
  calories: 539,
  protein_g: 6.3,
  carbs_g: 57.5,
  fat_g: 30.9,
  fiber_g: 0,
};

function build(overrides = {}) {
  return buildBarcodeMeal(BarcodeSaveSchema.parse({ ...PRODUCT_BASE, ...overrides }));
}

function saveDraft(draft) {
  return buildBarcodeMeal(BarcodeSaveSchema.parse(draftToSavePayload(draft, "2026-01-15")));
}

// Realistic OFF v2 payloads (trimmed to the fields the route requests).
const NUTELLA = {
  product: {
    product_name: "Nutella",
    brands: "Ferrero, Nutella",
    nutrition_data_per: "100g",
    quantity: "400 g",
    nutriments: {
      "energy-kcal_100g": 539,
      proteins_100g: 6.3,
      carbohydrates_100g: 57.5,
      fat_100g: 30.9,
      fiber_100g: 0,
    },
  },
};

// A drink: OFF keeps its per-100 ml values under the *_100g suffix and exposes
// the can as one serving.
const COCA_COLA = {
  product: {
    product_name: "Coca-Cola",
    quantity: "330 ml",
    product_quantity_unit: "ml",
    nutrition_data_per: "100g",
    serving_size: "1 portion (330 ml)",
    serving_quantity: 330,
    nutriments: {
      "energy-kcal_100g": 42,
      proteins_100g: 0,
      carbohydrates_100g: 10.6,
      fat_100g: 0,
      "energy-kcal_serving": 139,
      proteins_serving: 0,
      carbohydrates_serving: 35,
      fat_serving: 0,
    },
  },
};

/* ── Barcode validation ──────────────────────────────────────────────────── */

test("normalizeBarcode accepts valid UPC-A, EAN-13 and EAN-8 and strips separators", () => {
  assert.equal(normalizeBarcode("3017620422003"), "3017620422003");
  assert.equal(normalizeBarcode("301 7620 422003"), "3017620422003");
  assert.equal(normalizeBarcode("012345678905"), "012345678905");
  assert.equal(normalizeBarcode("96385074"), "96385074");
});

test("normalizeBarcode rejects wrong lengths, letters, and bad check digits", () => {
  assert.equal(normalizeBarcode("3017620422004"), null);
  assert.equal(normalizeBarcode("12345"), null);
  assert.equal(normalizeBarcode("not-a-barcode"), null);
  assert.equal(normalizeBarcode(""), null);
  assert.equal(normalizeBarcode(null), null);
});

test("isRealDate rejects impossible calendar dates", () => {
  assert.equal(isRealDate("2026-01-15"), true);
  assert.equal(isRealDate("2026-02-31"), false);
  assert.equal(isRealDate("2026-13-01"), false);
  assert.equal(isRealDate("15-01-2026"), false);
});

/* ── Open Food Facts normalization ───────────────────────────────────────── */

test("parseBarcodeProduct converts kJ to kcal when energy is listed in kJ only", () => {
  const product = parseBarcodeProduct("3017620422003", {
    product: {
      product_name: "Test spread",
      brands: "Ferrero, Nutella",
      nutrition_data_per: "100g",
      nutriments: { "energy-kj_100g": 2255, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
    },
  });

  assert.equal(product.nutrition.calories, 539);
  assert.equal(product.basis, "100g");
  assert.equal(product.basisLabel, "per 100 g");
  assert.equal(product.brand, "Ferrero");
  assert.equal(product.missing.length, 0);
  assert.equal(product.servingNutrition, null);
  assert.equal(product.sourceUrl, "https://world.openfoodfacts.org/product/3017620422003");
});

test("parseBarcodeProduct keeps zero distinct from missing and never invents per-piece servings", () => {
  const product = parseBarcodeProduct("012345678905", {
    product: {
      product_name: "Sliced thing",
      nutrition_data_per: "100g",
      // Two slices in the label serving: we must NOT present this as one slice.
      serving_size: "2 slices (56 g)",
      nutriments: {
        "energy-kcal_100g": 250,
        proteins_100g: 0,
        fat_100g: 10,
        fiber_100g: 3,
      },
    },
  });

  assert.equal(product.nutrition.protein_g, 0, "a real 0 stays 0");
  assert.equal(product.nutrition.carbs_g, null, "missing stays null, not zero");
  assert.deepEqual(product.missing, ["carbs_g"]);
  assert.equal(product.basis, "100g");
  assert.equal(product.basisLabel, "per 100 g");
  assert.equal(product.servingText, "2 slices (56 g)", "the label serving stays explicit");
  assert.equal(product.servingNutrition, null, "no per-serving values were provided");
});

test("parseBarcodeProduct reads a liquid's *_100g values as per 100 ml and exposes its serving", () => {
  const product = parseBarcodeProduct("5449000000996", COCA_COLA);

  assert.equal(product.basis, "100ml");
  assert.equal(product.unit, "ml");
  assert.equal(product.basisAmount, 100);
  assert.equal(product.basisLabel, "per 100 ml");
  assert.equal(product.nutrition.calories, 42, "per-100 ml energy, not per-100 g");
  assert.equal(product.servingText, "1 portion (330 ml)");
  assert.equal(product.servingNutrition?.calories, 139);
  assert.match(product.note ?? "", /per 100 ml/);
});

test("parseBarcodeProduct honours nutrition_data_per:100ml even without a quantity unit", () => {
  const product = parseBarcodeProduct("96385074", {
    product: {
      product_name: "Juice",
      nutrition_data_per: "100ml",
      nutriments: { "energy-kcal_100g": 45, proteins_100g: 0.5, carbohydrates_100g: 10, fat_100g: 0 },
    },
  });

  assert.equal(product.basis, "100ml");
  assert.equal(product.unit, "ml");
  assert.equal(product.basisLabel, "per 100 ml");
  assert.equal(product.nutrition.calories, 45);
});

test("parseBarcodeProduct keeps the label's own serving basis when OFF reports one", () => {
  const product = parseBarcodeProduct("3017620422003", {
    product: {
      product_name: "Yogurt",
      nutrition_data_per: "serving",
      serving_size: "170 g",
      nutriments: {
        "energy-kcal_serving": 100,
        proteins_serving: 17,
        carbohydrates_serving: 6,
        fat_serving: 0,
      },
    },
  });

  assert.equal(product.basis, "serving");
  assert.equal(product.basisAmount, 1);
  assert.equal(product.basisLabel, "1 serving (170 g)");
  assert.equal(product.unit, "serving");
  assert.equal(product.servingNutrition, null, "the serving IS the product basis here");
});

/* ── Shared draft transitions (the bug the UI hit) ───────────────────────── */

test("switching to per-piece clears per-100 values and scales the reviewed piece values", () => {
  const product = parseBarcodeProduct("3017620422003", NUTELLA);
  let draft = draftFromProduct(product);

  assert.deepEqual(availableModes(draft), ["label", "piece"], "no per-serving data to offer");
  assert.equal(resolveBasis(draft).unit, "g");
  assert.equal(resolveBasis(draft).amount, 100);

  // The user thinks in slices and switches basis explicitly.
  draft = setBasisMode(draft, "piece");
  assert.equal(resolveBasis(draft).amount, 1);
  assert.equal(resolveBasis(draft).unit, "piece");
  assert.equal(draft.nutrition.protein, "", "per-100 values must not be reused per piece");
  assert.deepEqual(draftMissingRequired(draft), ["calories", "protein_g", "carbs_g", "fat_g"]);

  // They type the label's per-slice values and ate four slices.
  draft = {
    ...draft,
    pieceName: "slice",
    amount: "4",
    quantity: "4 slices",
    nutrition: { calories: "200", protein: "3", carbs: "20", fat: "10", fiber: "" },
  };
  assert.equal(resolveBasis(draft).label, "1 slice");
  assert.equal(quantityForAmount(draft, "4"), "4 slices");

  const payload = draftToSavePayload(draft, "2026-01-15");
  assert.equal(payload.basis_amount, 1, "one piece is the basis");
  assert.equal(payload.basis_label, "1 slice");

  const meal = buildBarcodeMeal(BarcodeSaveSchema.parse(payload));
  assert.equal(meal.factor, 4);
  assert.equal(meal.item.protein_g, 12, "3 g per slice x 4 slices");

  // The old failure mode: keeping basis_amount 100 with per-slice values gives 0.1 g.
  const stale = buildBarcodeMeal(BarcodeSaveSchema.parse({ ...payload, basis_amount: 100 }));
  assert.equal(stale.item.protein_g, 0.1);
});

test("the cosmetic piece name never changes the basis units or the maths", () => {
  let draft = draftFromProduct(parseBarcodeProduct("3017620422003", NUTELLA));
  draft = setBasisMode(draft, "piece");
  const renamed = { ...draft, pieceName: "biscuit" };

  assert.equal(resolveBasis(renamed).amount, 1);
  assert.equal(resolveBasis(renamed).unit, "piece");
  assert.equal(resolveBasis(renamed).label, "1 biscuit");
});

test("the label's own serving is usable fractionally (half a can = 0.5 serving)", () => {
  let draft = draftFromProduct(parseBarcodeProduct("5449000000996", COCA_COLA));
  assert.deepEqual(availableModes(draft), ["label", "serving", "piece"]);

  draft = setBasisMode(draft, "serving");
  assert.equal(draft.nutrition.calories, "139");
  assert.equal(resolveBasis(draft).label, "1 serving (1 portion (330 ml))");

  draft = { ...draft, amount: "0.5", quantity: "half a can" };
  const meal = saveDraft(draft);
  assert.equal(meal.factor, 0.5);
  assert.equal(meal.nutrition.calories, 69.5);

  // Returning to the label basis restores the product's own per-100 values.
  const back = setBasisMode(draft, "label");
  assert.equal(back.nutrition.calories, "42");
  assert.equal(resolveBasis(back).unit, "ml");
});

test("a per-piece product with no serving data only offers per-100 and per-piece", () => {
  const draft = draftFromProduct(parseBarcodeProduct("3017620422003", NUTELLA));
  assert.deepEqual(availableModes(draft), ["label", "piece"]);
});

test("clearing or zeroing the amount dashes the totals and disables save, then recovers", () => {
  // The regression: with scaled===null for factor<=0 the preview was hidden and
  // the draft stranded. draftTotals must stay null (dashes) while the draft,
  // basis and editor fields are still present and recoverable.
  const base = draftFromProduct(parseBarcodeProduct("3017620422003", NUTELLA));

  const blanked = { ...base, amount: "", quantity: "" };
  assert.equal(draftTotals(blanked), null, "blank amount → totals dash out");
  assert.equal(canSaveDraft(blanked, "2026-01-15"), false);

  const zeroed = { ...base, amount: "0", quantity: "0 g" };
  assert.equal(draftTotals(zeroed), null, "zero amount → totals dash out");
  assert.equal(canSaveDraft(zeroed, "2026-01-15"), false);

  const refilled = { ...base, amount: "150", quantity: "150 g" };
  assert.deepEqual(draftTotals(refilled), {
    calories: 808.5,
    protein_g: 9.5,
    carbs_g: 86.3,
    fat_g: 46.3,
    fiber_g: 0,
  });
  assert.equal(canSaveDraft(refilled, "2026-01-15"), true);
});

test("canSaveDraft reuses the shared schema: required fields, bounds and non-negative macros", () => {
  const base = draftFromProduct(parseBarcodeProduct("3017620422003", NUTELLA));
  assert.equal(canSaveDraft(base, "2026-01-15"), true);

  assert.equal(
    canSaveDraft({ ...base, nutrition: { ...base.nutrition, protein: "-1" } }, "2026-01-15"),
    false,
    "negative macros are out of range",
  );
  assert.equal(canSaveDraft({ ...base, amount: "100001" }, "2026-01-15"), false, "amount exceeds the shared bound");
  assert.equal(
    canSaveDraft({ ...base, name: "   " }, "2026-01-15"),
    false,
    "a blank product name is required",
  );
  assert.equal(canSaveDraft({ ...base, quantity: "" }, "2026-01-15"), false, "quantity is required");
});

test("renaming the piece refreshes an auto-generated quantity but keeps a typed one", () => {
  let draft = setBasisMode(draftFromProduct(parseBarcodeProduct("3017620422003", NUTELLA)), "piece");
  assert.equal(draft.quantity, "1 piece");

  draft = { ...draft, amount: "4", quantity: quantityForAmount(draft, "4") };
  assert.equal(draft.quantity, "4 pieces");

  const renamed = setPieceName(draft, "slice");
  assert.equal(renamed.pieceName, "slice");
  assert.equal(renamed.quantity, "4 slices", "the auto default follows the new piece name");

  const custom = setPieceName({ ...renamed, quantity: "four big slices" }, "biscuit");
  assert.equal(custom.quantity, "four big slices", "a quantity the user typed is left alone");
  assert.equal(resolveBasis(custom).label, "1 biscuit");
});

/* ── Scaling + save payload ──────────────────────────────────────────────── */

test("buildBarcodeMeal scales a label serving by a whole count (3 g protein x4 = 12 g)", () => {
  const draft = build({ basis_label: "1 slice", basis_amount: 1, amount: 4, protein_g: 3, quantity: "4 slices" });

  assert.equal(draft.factor, 4);
  assert.equal(draft.item.protein_g, 12);
  assert.equal(draft.item.calories, 2156);
  assert.equal(draft.item.confidence, "medium");
  assert.match(draft.assumptions[0], /scaled ×4/);
});

test("buildBarcodeMeal supports fractional quantities", () => {
  const draft = build({ basis_amount: 1, amount: 0.5, protein_g: 3, quantity: "half a slice" });

  assert.equal(draft.factor, 0.5);
  assert.equal(draft.item.protein_g, 1.5);
});

test("buildBarcodeMeal scales per-100 g values to the amount eaten", () => {
  const draft = build({ basis_amount: 100, amount: 150, quantity: "150 g" });

  assert.equal(draft.factor, 1.5);
  assert.equal(draft.item.calories, 808.5);
  assert.equal(draft.item.carbs_g, 86.3);
});

test("buildBarcodeMeal handles the weighed-piece case without inventing density", () => {
  // Label is per 100 g; one slice is 30 g and the user ate 4 slices (120 g total).
  const draft = build({ basis_amount: 100, amount: 120, quantity: "4 slices", protein_g: 10 });

  assert.equal(draft.factor, 1.2);
  assert.equal(draft.item.protein_g, 12);
});

test("scaleNutrition rounds to one decimal and keeps nulls null", () => {
  assert.deepEqual(scaleNutrition({ calories: 100, protein_g: null, carbs_g: 10, fat_g: 0, fiber_g: null }, 1.25), {
    calories: 125,
    protein_g: null,
    carbs_g: 12.5,
    fat_g: 0,
    fiber_g: null,
  });
});

/* ── Open Food Facts response mapping (route) ────────────────────────────── */

test("offLookupOutcome maps OFF 404 and status:0 payloads to not_found, not a server error", () => {
  assert.equal(offLookupOutcome(404, { status: 0, status_verbose: "product not found" }), "not_found");
  assert.equal(offLookupOutcome(200, { status: 0 }), "not_found");
  assert.equal(offLookupOutcome(200, { status: "failure" }), "not_found");
  assert.equal(offLookupOutcome(200, { status: 1 }), "not_found", "success status but no product");
  assert.equal(offLookupOutcome(200, null), "not_found");
});

test("offLookupOutcome treats real server/transport failures as unavailable", () => {
  assert.equal(offLookupOutcome(500, null), "unavailable");
  assert.equal(offLookupOutcome(503, { error: "maintenance" }), "unavailable");
  assert.equal(offLookupOutcome(429, null), "unavailable");
});

test("offLookupOutcome returns the product for a real success", () => {
  assert.equal(offLookupOutcome(200, { status: 1, product: { product_name: "Nutella" } }), "product");
  assert.equal(offLookupOutcome(200, NUTELLA), "product");
});

/* ── Invalid input ───────────────────────────────────────────────────────── */

test("BarcodeSaveSchema rejects zero/negative amounts, bad dates, and missing macros", () => {
  assert.equal(BarcodeSaveSchema.safeParse({ ...PRODUCT_BASE, amount: 0 }).success, false);
  assert.equal(BarcodeSaveSchema.safeParse({ ...PRODUCT_BASE, basis_amount: -1 }).success, false);
  assert.equal(BarcodeSaveSchema.safeParse({ ...PRODUCT_BASE, logged_on: "2026-02-31" }).success, false);
  assert.equal(BarcodeSaveSchema.safeParse({ ...PRODUCT_BASE, protein_g: undefined }).success, false);
  assert.equal(BarcodeSaveSchema.safeParse({ ...PRODUCT_BASE, quantity: "  " }).success, false);
});

test("an unfilled per-piece draft cannot be saved", () => {
  let draft = draftFromProduct(parseBarcodeProduct("3017620422003", NUTELLA));
  draft = setBasisMode(draft, "piece");
  const payload = draftToSavePayload(draft, "2026-01-15");
  assert.equal(BarcodeSaveSchema.safeParse(payload).success, false, "blank macros are not zero");
});

test("buildBarcodeMeal rejects an invalid barcode and an absurd scale factor", () => {
  assert.throws(() => build({ barcode: "12345" }), /valid UPC\/EAN/);
  assert.throws(() => build({ basis_amount: 1, amount: 100_000 }), /realistic amount/);
});

test("buildBarcodeMeal builds OFF source attribution from the validated barcode", () => {
  const draft = build();

  assert.equal(draft.item.source_url, "https://world.openfoodfacts.org/product/3017620422003");
  assert.equal(draft.item.source_title, "Open Food Facts");
  assert.equal(draft.title, "Ferrero Nutella");
});

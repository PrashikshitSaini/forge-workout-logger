import assert from "node:assert/strict";
import test from "node:test";
import {
  NutritionVerificationError,
  verifyAndScaleItem,
} from "../lib/nutrition-research.ts";

const citation = {
  url: "https://example.com/products/black-beans?ref=search",
  title: "Black Beans Nutrition Facts",
  content:
    "Serving size 1/2 cup (130g). Calories 110. Total Fat 0.5g. Total Carbohydrate 20g. Protein 7g. Dietary Fiber 6g.",
};

const item = {
  name: "Black beans",
  brand: "Example",
  quantity: "1 cup",
  source_serving: "1/2 cup (130g)",
  consumed_amount: 1,
  consumed_unit: "cup",
  source_amount: 0.5,
  source_unit: "cup",
  label: {
    calories: 110,
    protein_g: 7,
    carbs_g: 20,
    fat_g: 0.5,
    fiber_g: 6,
  },
  source_url: "https://example.com/products/black-beans",
  source_title: "Example black beans",
  evidence:
    "Serving size 1/2 cup (130g). Calories 110. Total Fat 0.5g. Total Carbohydrate 20g. Protein 7g. Dietary Fiber 6g.",
  confidence: "high",
};

test("uses cited per-serving facts and scales them on the server", () => {
  assert.deepEqual(verifyAndScaleItem(item, [citation]), {
    name: "Black beans",
    brand: "Example",
    quantity: "1 cup",
    calories: 220,
    protein_g: 14,
    carbs_g: 40,
    fat_g: 1,
    fiber_g: 12,
    source_url: citation.url,
    source_title: citation.title,
    confidence: "high",
  });
});

test("rejects a URL that was not returned by search", () => {
  assert.throws(
    () => verifyAndScaleItem({ ...item, source_url: "https://invented.example/label" }, [citation]),
    NutritionVerificationError,
  );
});

test("rejects evidence that was not quoted from the search result", () => {
  assert.throws(
    () => verifyAndScaleItem({ ...item, evidence: "A completely different nutrition label with 110 calories." }, [citation]),
    NutritionVerificationError,
  );
});

test("rejects macros whose numbers are missing from the source excerpt", () => {
  assert.throws(
    () => verifyAndScaleItem({ ...item, label: { ...item.label, protein_g: 17 } }, [citation]),
    NutritionVerificationError,
  );
});

test("rejects a serving conversion whose units do not match", () => {
  assert.throws(
    () => verifyAndScaleItem({ ...item, consumed_unit: "g" }, [citation]),
    NutritionVerificationError,
  );
});

test("rejects a source serving amount absent from its evidence", () => {
  assert.throws(
    () => verifyAndScaleItem({ ...item, source_amount: 0.75 }, [citation]),
    NutritionVerificationError,
  );
});

test("rejects a source serving unit absent from its evidence", () => {
  assert.throws(
    () => verifyAndScaleItem({ ...item, consumed_unit: "oz", source_unit: "oz" }, [citation]),
    NutritionVerificationError,
  );
});

test("rejects internally implausible nutrition labels", () => {
  const badCitation = {
    ...citation,
    content: citation.content.replace("Protein 7g", "Protein 70g"),
  };
  const badItem = {
    ...item,
    label: { ...item.label, protein_g: 70 },
    evidence: item.evidence.replace("Protein 7g", "Protein 70g"),
  };
  assert.throws(() => verifyAndScaleItem(badItem, [badCitation]), NutritionVerificationError);
});

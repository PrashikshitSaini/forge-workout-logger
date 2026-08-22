/** Sets have always been stored in pounds. Convert only at the user interface. */
export type WeightUnit = "lb" | "kg";

const KILOGRAMS_PER_POUND = 0.45359237;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function displayWeight(storedPounds: number | null, unit: WeightUnit): number | null {
  if (storedPounds == null) return null;
  return unit === "kg" ? round(storedPounds * KILOGRAMS_PER_POUND) : storedPounds;
}

export function storedWeight(displayValue: number | null, unit: WeightUnit): number | null {
  if (displayValue == null) return null;
  return unit === "kg" ? round(displayValue / KILOGRAMS_PER_POUND) : displayValue;
}

export function formatWeight(storedPounds: number | null, unit: WeightUnit): string {
  const value = displayWeight(storedPounds, unit);
  return value == null ? "–" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

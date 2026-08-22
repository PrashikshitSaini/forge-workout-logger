import { formatDuration } from "./format";
import { formatWeight, type WeightUnit } from "./weight-units";

interface SetLike {
  weight: number | null;
  reps: number | null;
  duration_seconds: number | null;
  level: number | null;
}

/** Compact one-line summary of a set list, e.g. "70×8 · 70×8 · 65×10" or "18 min · L10". */
export function summarizeSets(sets: SetLike[], type: string, weightUnit: WeightUnit = "lb"): string {
  if (!sets.length) return "";
  if (type === "cardio") {
    const s = sets[0];
    const parts: string[] = [];
    if (s.duration_seconds) parts.push(formatDuration(s.duration_seconds));
    if (s.level != null) parts.push(`L${s.level}`);
    return parts.join(" · ") || "–";
  }
  const entries = sets
    .filter((s) => s.weight != null || s.reps != null)
    .map((s) => `${formatWeight(s.weight, weightUnit)}×${s.reps ?? "–"}`);
  return entries.join(" · ");
}

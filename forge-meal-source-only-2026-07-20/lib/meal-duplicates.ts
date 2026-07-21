export interface MealDuplicateCandidate {
  id: string;
  title: string;
  original_input: string;
}

const IGNORED_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "made",
  "meal",
  "my",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

function normalizedText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    normalizedText(value)
      .split(" ")
      .filter((word) => word.length > 1 && !IGNORED_WORDS.has(word)),
  );
}

function tokenSimilarity(first: string, second: string): number {
  const firstTokens = meaningfulTokens(first);
  const secondTokens = meaningfulTokens(second);
  if (firstTokens.size === 0 || secondTokens.size === 0) return 0;

  const overlap = [...firstTokens].filter((word) => secondTokens.has(word)).length;
  if (overlap < 2) return 0;
  return overlap / Math.min(firstTokens.size, secondTokens.size);
}

function resemblance(first: string, second: string): number {
  const normalizedFirst = normalizedText(first);
  const normalizedSecond = normalizedText(second);
  if (!normalizedFirst || !normalizedSecond) return 0;
  if (normalizedFirst === normalizedSecond) return 1;
  if (
    Math.min(normalizedFirst.length, normalizedSecond.length) >= 12 &&
    (normalizedFirst.includes(normalizedSecond) || normalizedSecond.includes(normalizedFirst))
  ) {
    return 0.9;
  }
  return tokenSimilarity(normalizedFirst, normalizedSecond);
}

/**
 * Finds a same-day meal that merits a user-visible duplicate choice. This is
 * deliberately conservative: it is only a suggestion and never merges meals.
 */
export function findSimilarMeal<T extends MealDuplicateCandidate>(
  title: string,
  originalInput: string,
  meals: T[],
): T | null {
  let closest: T | null = null;
  let highestScore = 0;

  for (const meal of meals) {
    const score = Math.max(
      resemblance(title, meal.title),
      resemblance(originalInput, meal.original_input),
    );
    if (score >= 0.65 && score > highestScore) {
      closest = meal;
      highestScore = score;
    }
  }

  return closest;
}

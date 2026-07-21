import { ResearchAnalysisSchema, scaleResearchedAnalysis, type NutritionCitation, type ResearchAnalysis, type VerifiedMealItem } from "./nutrition-research.ts";
import { retryDelaySeconds } from "./meal-jobs.ts";

export type WorkerOutcome =
  | { kind: "finalize"; analysis: ResearchAnalysis; items: VerifiedMealItem[] }
  | { kind: "retry"; code: string; message: string; delaySeconds: number }
  | { kind: "review"; code: string; message: string; draft: ReturnType<typeof finalizationPayload> | null };

export interface MealResearchProvider {
  research(input: { text: string; loggedOn: string }): Promise<{ analysis: unknown; citations: NutritionCitation[] }>;
}

export async function researchJob(
  provider: MealResearchProvider,
  job: { original_input: string; logged_on: string; attempt_count: number; max_attempts: number },
  random: () => number = Math.random,
): Promise<WorkerOutcome> {
  try {
    const response = await provider.research({ text: job.original_input, loggedOn: job.logged_on });
    const analysis = ResearchAnalysisSchema.parse(response.analysis);
    const items = scaleResearchedAnalysis(analysis, response.citations);
    const hasUnverified = items.some((item) => item.confidence === "low");
    if (hasUnverified) return { kind: "review", code: "nutrition_unverified", message: "Forge could not verify every nutrition label. Review the estimate before saving.", draft: finalizationPayload(analysis, items) };
    return { kind: "finalize", analysis, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meal research failed.";
    const retryable = /timeout|network|fetch|rate|429|5\d\d/i.test(message);
    if (retryable && job.attempt_count < job.max_attempts) {
      return { kind: "retry", code: "provider_unavailable", message, delaySeconds: retryDelaySeconds(job.attempt_count, random) };
    }
    return { kind: "review", code: retryable ? "provider_unavailable" : "nutrition_unavailable", message: "Forge kept your request so you can edit, retry, or save an estimate.", draft: null };
  }
}

export function finalizationPayload(analysis: ResearchAnalysis, items: VerifiedMealItem[]) {
  return { title: analysis.title, meal_type: analysis.meal_type, assumptions: analysis.assumptions, items };
}

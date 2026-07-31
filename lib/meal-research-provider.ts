export const MEAL_RESEARCH_MODEL = "google/gemini-3.5-flash";

export interface MealResearchMessage {
  role: "system" | "user";
  content: string;
}

export interface MealResearchRequest {
  apiKey: string;
  siteUrl: string;
  title: string;
  messages: MealResearchMessage[];
}

/**
 * Build the single provider request used by meal logging. The `web` plugin
 * augments the request exactly once, unlike model-driven server tools which
 * can repeatedly search before returning an answer.
 */
export async function requestMealResearch(
  request: MealResearchRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": request.siteUrl,
      "X-Title": request.title,
    },
    body: JSON.stringify({
      model: MEAL_RESEARCH_MODEL,
      messages: request.messages,
      plugins: [{ id: "web", engine: "exa", max_results: 3 }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1_500,
    }),
  });
}

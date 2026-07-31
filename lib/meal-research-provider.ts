export const MEAL_RESEARCH_MODEL = "google/gemini-2.5-flash";

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
 * Build the provider request used by meal logging. The first attempt uses the
 * web plugin; if a provider returns a successful response with no text, retry
 * once without the plugin so a transient web-augmentation failure does not
 * block an otherwise valid estimate.
 */
export async function requestMealResearch(
  request: MealResearchRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const body = {
    model: MEAL_RESEARCH_MODEL,
    messages: request.messages,
    plugins: [{ id: "web", engine: "exa", max_results: 3 }],
    max_tokens: 1_500,
  };
  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": request.siteUrl,
      "X-Title": request.title,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return response;
  try {
    const payload = (await response.clone().json()) as {
      choices?: { message?: { content?: unknown }; text?: unknown }[];
      output_text?: unknown;
    };
    const hasText = (value: unknown): boolean => {
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.some(hasText);
      if (!value || typeof value !== "object") return false;
      const record = value as Record<string, unknown>;
      return [record.text, record.content, record.output_text].some(hasText);
    };
    const content = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text ?? payload.output_text;
    if (hasText(content)) return response;
  } catch {
    return response;
  }

  const fallbackBody = {
    ...body,
    plugins: undefined,
    messages: [
      ...request.messages,
      {
        role: "user" as const,
        content: "Return the meal JSON now using practical estimates. Do not ask questions and do not use tools.",
      },
    ],
  };
  delete fallbackBody.plugins;
  return fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": request.siteUrl,
      "X-Title": request.title,
    },
    body: JSON.stringify(fallbackBody),
  });
}

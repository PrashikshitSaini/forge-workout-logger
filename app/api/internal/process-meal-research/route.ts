import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { finalizationPayload, researchJob, type MealResearchProvider } from "@/lib/meal-worker";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.MEAL_WORKER_SECRET;
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
}

const provider: MealResearchProvider = {
  async research({ text, loggedOn }) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("provider unavailable");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.MEAL_LOGGER_MODEL || "google/gemini-3.5-flash",
        messages: [{ role: "system", content: "Research meal nutrition with web search. Return JSON with title, meal_type, assumptions, and items containing name, brand, quantity, source_serving, consumed_amount, consumed_unit, source_amount, source_unit, label, source_url, source_title, evidence, confidence." }, { role: "user", content: `Log this meal for ${loggedOn}: ${text}` }],
        tools: [{ type: "openrouter:web_search", parameters: { engine: "native", max_results: 6, max_total_results: 30 } }, { type: "openrouter:web_fetch", parameters: { engine: "openrouter", max_uses: 12, max_content_tokens: 20_000 } }],
        tool_choice: "required", response_format: { type: "json_object" }, temperature: 0.1, max_tokens: 2400,
      }),
    });
    if (!response.ok) throw new Error(`provider ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string; annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string; content?: string } }> } }> };
    const message = payload.choices?.[0]?.message;
    const content = message?.content?.trim();
    if (!content) throw new Error("provider returned no meal analysis");
    const start = content.indexOf("{"); const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("provider returned invalid meal analysis");
    const citations = (message?.annotations ?? []).flatMap((annotation) => annotation.type === "url_citation" && annotation.url_citation?.url ? [{ url: annotation.url_citation.url, title: annotation.url_citation.title ?? "Nutrition source", content: annotation.url_citation.content ?? "" }] : []);
    return { analysis: JSON.parse(content.slice(start, end + 1)), citations };
  },
};

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  const { data: job, error } = await supabase.rpc("claim_due_meal_research_job");
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  if (!job) return NextResponse.json({ ok: true, processed: false });
  const outcome = await researchJob(provider, job);
  if (outcome.kind === "finalize") {
    const { data: mealId, error: finishError } = await supabase.rpc("finalize_meal_research_job", { p_job_id: job.id, p_lock_token: job.lock_token, p_result: finalizationPayload(outcome.analysis, outcome.items) });
    return finishError ? NextResponse.json({ error: finishError.message }, { status: 503 }) : NextResponse.json({ ok: true, processed: true, meal_id: mealId });
  }
  const { error: resolveError } = await supabase.rpc("resolve_meal_research_job", { p_job_id: job.id, p_lock_token: job.lock_token, p_outcome: outcome.kind === "retry" ? "retry" : "review", p_result: outcome.kind === "review" ? outcome.draft : null, p_error_code: outcome.code, p_error_message: outcome.message, p_delay_seconds: outcome.kind === "retry" ? outcome.delaySeconds : 0 });
  return resolveError ? NextResponse.json({ error: resolveError.message }, { status: 503 }) : NextResponse.json({ ok: true, processed: true, outcome: outcome.kind });
}

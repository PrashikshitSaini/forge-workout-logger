import { NextResponse } from "next/server";
import { z } from "zod";
import { APP_NAME } from "@/lib/constants";
import { rateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findSimilarMeal } from "@/lib/meal-duplicates";
import {
  ResearchAnalysisSchema,
  scaleResearchedAnalysis,
  type NutritionCitation,
  type VerifiedMealItem,
} from "@/lib/nutrition-research";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RequestSchema = z.object({
  text: z.string().trim().min(3).max(5000),
  logged_on: z.string().regex(DATE_RE),
  meal_id: z.string().uuid().optional(),
  allow_duplicate: z.boolean().optional(),
});

const SYSTEM_PROMPT = `You are the fast meal-estimation engine inside ${APP_NAME}.
Turn the user's natural-language meal into an itemized macro log immediately.

Rules:
- Do not browse or call tools. Use your nutrition knowledge to give the closest practical estimate in one response.
- Include only foods, quantities, oils, sauces, and cooking ingredients the user mentions.
- If preparation or quantity is unclear, use an ordinary serving and state that short assumption.
- Never refuse because a product cannot be identified. Use confidence "low" when estimating.
- For every item, set source_url, source_title, and evidence to null. Use the consumed quantity for both consumed and source amount/unit so the server stores the estimate directly.
- Use one of: g, ml, oz, cup, tbsp, tsp, piece, slice, container, package, serving.

Output ONLY one JSON object with this exact shape:
{
  "title": "short human meal name",
  "meal_type": "breakfast|lunch|dinner|snack|meal",
  "assumptions": ["short assumption, only when needed"],
  "items": [{
    "name": "product or food",
    "brand": "brand or null",
    "quantity": "the consumed quantity in plain language",
    "source_serving": "serving size exactly as stated by the source",
    "consumed_amount": 1,
    "consumed_unit": "cup",
    "source_amount": 0.5,
    "source_unit": "cup",
    "label": {
      "calories": 0,
      "protein_g": 0,
      "carbs_g": 0,
      "fat_g": 0,
      "fiber_g": 0
    },
    "source_url": "direct supporting URL or null",
    "source_title": "short source label or null",
    "evidence": "source excerpt containing the nutrition facts or null",
    "confidence": "high|medium|low"
  }]
}`;

function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a JSON object.");
  return JSON.parse(content.slice(start, end + 1));
}

function totals(items: VerifiedMealItem[]) {
  const sum = (key: "calories" | "protein_g" | "carbs_g" | "fat_g") =>
    Math.round(items.reduce((total, item) => total + item[key], 0) * 10) / 10;
  return {
    calories: sum("calories"),
    protein_g: sum("protein_g"),
    carbs_g: sum("carbs_g"),
    fat_g: sum("fat_g"),
  };
}

interface OpenRouterAnnotation {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
    content?: string;
  };
}

function extractCitations(annotations: OpenRouterAnnotation[] | undefined): NutritionCitation[] {
  const citations = new Map<string, NutritionCitation>();
  for (const annotation of annotations ?? []) {
    const citation = annotation.url_citation;
    if (annotation.type !== "url_citation" || !citation?.url) continue;
    citations.set(citation.url, {
      url: citation.url,
      title: citation.title?.trim() || new URL(citation.url).hostname,
      content: citation.content ?? "",
    });
  }
  return [...citations.values()];
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { ok, retryAfter } = rateLimit(`meal:${user.id}`, 12, 60_000);
  if (!ok) {
    return NextResponse.json(
      { error: "Give the nutrition researcher a moment." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Describe the meal and choose a valid date." }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  try {
    // Keep nutrition research independent from the conversational coach model.
    // A direct Gemini estimate is the fast path. Web search made this simple
    // action unbounded and prevented users from logging meals quickly.
    const model = "google/gemini-3.5-flash";
    const maxTokens = 1_200;
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
        "X-Title": APP_NAME,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Log this meal for ${body.logged_on}:\n\n${body.text}`,
          },
        ],
        max_tokens: maxTokens,
      }),
    });

    if (!aiResponse.ok) {
      console.error("Meal research error", aiResponse.status, await aiResponse.text().catch(() => ""));
      const error =
        aiResponse.status === 400
          ? "Meal research rejected this request. Please try again in a moment."
          : aiResponse.status === 401 || aiResponse.status === 403
            ? "Meal research connection was rejected."
            : aiResponse.status === 402
              ? "Meal research needs available provider credit."
              : aiResponse.status === 429
                ? "Meal research is busy. Please try again shortly."
                : "Meal research is temporarily unavailable.";
      return NextResponse.json({ error, provider_status: aiResponse.status }, { status: 502 });
    }

    const payload = (await aiResponse.json()) as {
      choices?: { message?: { content?: string; annotations?: OpenRouterAnnotation[] } }[];
    };
    const message = payload.choices?.[0]?.message;
    const content = message?.content?.trim();
    if (!content) throw new Error("Empty meal research response.");
    const analysis = ResearchAnalysisSchema.parse(extractJson(content));
    const items = scaleResearchedAnalysis(analysis, extractCitations(message?.annotations));

    if (!body.meal_id && !body.allow_duplicate) {
      const { data: existingMeals, error: existingMealsError } = await supabase
        .from("meals")
        .select("id, title, original_input")
        .eq("logged_on", body.logged_on)
        .returns<{ id: string; title: string; original_input: string }[]>();
      if (existingMealsError) throw existingMealsError;

      const duplicate = findSimilarMeal(analysis.title, body.text, existingMeals ?? []);
      if (duplicate) {
        return NextResponse.json(
          {
            error: "This looks similar to a meal already logged today.",
            duplicate: { meal_id: duplicate.id, title: duplicate.title },
          },
          { status: 409 },
        );
      }
    }

    const mealMutation = body.meal_id ? "replace_meal" : "create_meal";
    const mutationParameters = {
      p_logged_on: body.logged_on,
      p_meal_type: analysis.meal_type,
      p_title: analysis.title,
      p_original_input: body.text,
      p_assumptions: analysis.assumptions,
      p_items: items,
      ...(body.meal_id ? { p_meal_id: body.meal_id } : {}),
    };
    const { data: mealId, error: saveError } = await supabase.rpc(mealMutation, mutationParameters);
    if (saveError) throw saveError;

    return NextResponse.json({
      ok: true,
      meal_id: mealId as string,
      title: analysis.title,
      totals: totals(items),
    });
  } catch (err) {
    console.error("Meal analysis failed", err);
    const missingMigration = err instanceof Error && /create_meal|replace_meal|schema cache/i.test(err.message);
    return NextResponse.json(
      {
        error: missingMigration
          ? "Meal storage is not ready. Apply migrations 0005 and 0008 first."
          : "I couldn't turn that into a meal. Add a little more detail and try once more.",
      },
      { status: 502 },
    );
  }
}

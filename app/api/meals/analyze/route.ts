import { NextResponse } from "next/server";
import { z } from "zod";
import { APP_NAME } from "@/lib/constants";
import { rateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  NutritionVerificationError,
  ResearchAnalysisSchema,
  verifyAndScaleAnalysis,
  type NutritionCitation,
  type VerifiedMealItem,
} from "@/lib/nutrition-research";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RequestSchema = z.object({
  text: z.string().trim().min(3).max(5000),
  logged_on: z.string().regex(DATE_RE),
});

const SYSTEM_PROMPT = `You are the nutrition research engine inside ${APP_NAME}.
The user describes a meal naturally. Turn it into an itemized macro log.

Research rules:
- You MUST web-search every distinct item before answering. Search for the exact product plus "nutrition facts calories protein carbs fat serving size". Group items into one query only when that still finds each exact label.
- Prefer the brand/manufacturer nutrition page, retailer product label, USDA FoodData Central, or another primary nutrition-label source. Avoid blogs, social media, recipe sites, and unsourced calorie databases.
- Research the SOURCE LABEL serving first. Return its unscaled macros in "label" and its serving text in "source_serving".
- Normalize the user's consumed quantity and one source serving into the SAME unit using "consumed_amount"/"consumed_unit" and "source_amount"/"source_unit". Allowed units: g, ml, oz, cup, tbsp, tsp, piece, slice, container, package, serving.
- Prefer a unit explicitly present in both the user's quantity and source serving. Example: user ate 1 cup and label says 1/2 cup (130g) → consumed_amount 1 cup, source_amount 0.5 cup. User ate 100g → consumed_amount 100g, source_amount 130g.
- If the source does not support a same-unit conversion, search for another authoritative source. Do not estimate density or invent a conversion.
- The server—not you—will divide consumed_amount by source_amount and multiply the label macros.
- For generic whole foods, use a reputable standard nutrition source. Never invent a branded product.
- If preparation is ambiguous (for example cooked vs dry rice), choose the most ordinary interpretation and state it in assumptions.
- Include oils, sauces, and cooking ingredients only when the user mentions them. Do not silently add ingredients.
- Use the exact direct URL returned by web search. Copy a short VERBATIM excerpt containing serving size, calories, protein, carbs, and fat into "evidence". Do not paraphrase it.
- If the search result does not expose enough label evidence, search again. If exact evidence still cannot be found, do not guess.
- Mark confidence high only for an exact product/variant and exact serving conversion; medium for an authoritative generic-food match; low for any necessary approximation.

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
    "source_url": "direct supporting URL",
    "source_title": "short source label",
    "evidence": "verbatim source excerpt containing the nutrition facts",
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
    if (annotation.type !== "url_citation" || !citation?.url || !citation.content) continue;
    citations.set(citation.url, {
      url: citation.url,
      title: citation.title?.trim() || new URL(citation.url).hostname,
      content: citation.content,
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
    // Gemini 3 Flash has reliable tool use + structured extraction; Exa gives
    // us extractive page evidence that the server can verify deterministically.
    const model = process.env.MEAL_LOGGER_MODEL || "google/gemini-3-flash-preview";
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
        tools: [
          {
            type: "openrouter:web_search",
            parameters: {
              engine: "exa",
              max_results: 4,
              max_total_results: 30,
              max_characters: 6_000,
              excluded_domains: [
                "reddit.com",
                "pinterest.com",
                "facebook.com",
                "instagram.com",
                "tiktok.com",
                "youtube.com",
              ],
            },
          },
        ],
        tool_choice: "required",
        response_format: { type: "json_object" },
        reasoning: { effort: "low", exclude: true },
        temperature: 0.1,
        max_tokens: 2400,
      }),
    });

    if (!aiResponse.ok) {
      console.error("Meal research error", aiResponse.status, await aiResponse.text().catch(() => ""));
      return NextResponse.json({ error: "Meal research is unavailable right now." }, { status: 502 });
    }

    const payload = (await aiResponse.json()) as {
      choices?: { message?: { content?: string; annotations?: OpenRouterAnnotation[] } }[];
    };
    const message = payload.choices?.[0]?.message;
    const content = message?.content?.trim();
    if (!content) throw new Error("Empty meal research response.");
    const analysis = ResearchAnalysisSchema.parse(extractJson(content));
    const items = verifyAndScaleAnalysis(analysis, extractCitations(message?.annotations));

    const { data: mealId, error: saveError } = await supabase.rpc("create_meal", {
      p_logged_on: body.logged_on,
      p_meal_type: analysis.meal_type,
      p_title: analysis.title,
      p_original_input: body.text,
      p_assumptions: analysis.assumptions,
      p_items: items,
    });
    if (saveError) throw saveError;

    return NextResponse.json({
      ok: true,
      meal_id: mealId as string,
      title: analysis.title,
      totals: totals(items),
    });
  } catch (err) {
    console.error("Meal analysis failed", err);
    const missingMigration = err instanceof Error && /create_meal|schema cache/i.test(err.message);
    const verificationFailed = err instanceof NutritionVerificationError;
    return NextResponse.json(
      {
        error: missingMigration
          ? "Meal storage is not ready. Apply migration 0005 first."
          : verificationFailed
            ? "I found results, but couldn't verify every nutrition label. Add the exact product or serving details and try again."
          : "I couldn't turn that into a reliable meal. Add quantities and try once more.",
      },
      { status: verificationFailed ? 422 : 502 },
    );
  }
}

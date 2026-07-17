import { NextResponse } from "next/server";
import { z } from "zod";
import { APP_NAME } from "@/lib/constants";
import { rateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RequestSchema = z.object({
  text: z.string().trim().min(3).max(5000),
  logged_on: z.string().regex(DATE_RE),
});

const ItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().min(1).max(120).nullable(),
  quantity: z.string().trim().min(1).max(120),
  calories: z.number().min(0).max(100_000),
  protein_g: z.number().min(0).max(10_000),
  carbs_g: z.number().min(0).max(10_000),
  fat_g: z.number().min(0).max(10_000),
  fiber_g: z.number().min(0).max(10_000).nullable(),
  source_url: z.string().url().max(2000).nullable(),
  source_title: z.string().trim().min(1).max(240).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

const AnalysisSchema = z.object({
  title: z.string().trim().min(1).max(120),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "meal"]),
  assumptions: z.array(z.string().trim().min(1).max(240)).max(8),
  items: z.array(ItemSchema).min(1).max(30),
});

const SYSTEM_PROMPT = `You are the nutrition research engine inside ${APP_NAME}.
The user describes a meal naturally. Turn it into an itemized macro log.

Research rules:
- Use web search for every branded, packaged, restaurant, or otherwise specific product.
- Prefer the brand/manufacturer nutrition page, retailer label, or USDA-style authoritative data.
- Match the user's stated serving exactly. Convert the source serving to their grams, cups, pieces, or portions.
- For generic whole foods, use a reputable standard nutrition source. Never invent a branded product.
- If preparation is ambiguous (for example cooked vs dry rice), choose the most ordinary interpretation and state it in assumptions.
- Include oils, sauces, and cooking ingredients only when the user mentions them. Do not silently add ingredients.
- Item macros must already be scaled to the user's consumed quantity, not the label serving.
- Be practical, not falsely precise. Numbers may be estimates, but must be internally plausible.

Output ONLY one JSON object with this exact shape:
{
  "title": "short human meal name",
  "meal_type": "breakfast|lunch|dinner|snack|meal",
  "assumptions": ["short assumption, only when needed"],
  "items": [{
    "name": "product or food",
    "brand": "brand or null",
    "quantity": "the consumed quantity in plain language",
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "fiber_g": 0,
    "source_url": "direct supporting URL or null",
    "source_title": "short source label or null",
    "confidence": "high|medium|low"
  }]
}`;

function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a JSON object.");
  return JSON.parse(content.slice(start, end + 1));
}

function totals(items: z.infer<typeof ItemSchema>[]) {
  const sum = (key: "calories" | "protein_g" | "carbs_g" | "fat_g") =>
    Math.round(items.reduce((total, item) => total + item[key], 0) * 10) / 10;
  return {
    calories: sum("calories"),
    protein_g: sum("protein_g"),
    carbs_g: sum("carbs_g"),
    fat_g: sum("fat_g"),
  };
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
    // GPT-5 Mini is inexpensive, reliable at tool use/structured output, and
    // supports OpenRouter's native grounded web-search path.
    const model = process.env.MEAL_LOGGER_MODEL || "openai/gpt-5-mini";
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
              engine: "auto",
              max_results: 4,
              max_total_results: 10,
              search_context_size: "low",
            },
          },
        ],
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
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty meal research response.");
    const analysis = AnalysisSchema.parse(extractJson(content));

    const { data: mealId, error: saveError } = await supabase.rpc("create_meal", {
      p_logged_on: body.logged_on,
      p_meal_type: analysis.meal_type,
      p_title: analysis.title,
      p_original_input: body.text,
      p_assumptions: analysis.assumptions,
      p_items: analysis.items,
    });
    if (saveError) throw saveError;

    return NextResponse.json({
      ok: true,
      meal_id: mealId as string,
      title: analysis.title,
      totals: totals(analysis.items),
    });
  } catch (err) {
    console.error("Meal analysis failed", err);
    const missingMigration = err instanceof Error && /create_meal|schema cache/i.test(err.message);
    return NextResponse.json(
      {
        error: missingMigration
          ? "Meal storage is not ready. Apply migration 0005 first."
          : "I couldn't turn that into a reliable meal. Add quantities and try once more.",
      },
      { status: 502 },
    );
  }
}

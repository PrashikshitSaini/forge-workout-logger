import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { rateLimit } from "@/lib/rate-limit";
import { APP_NAME } from "@/lib/constants";

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
  context: z.string().max(8000).optional(),
});

const SYSTEM_PROMPT = `You are the in-app coach for ${APP_NAME}, a training and nutrition logger. You talk to one lifter about THEIR numbers.

Voice: a sharp, confident training partner with a bit of edge — the strongest, most dialed-in friend at the gym. Punchy, dry wit, gym-literate. Cool, never corny. Banned: motivational-poster clichés ("you got this", "let's crush it", "beast mode"), hedging, "as an AI", emoji spam. Confidence comes from knowing their data cold, not hype.

Rules:
- Ground every claim in the numbers in CONTEXT — name concrete weights, reps, dates, counts. Specifics are what make you sound like you actually know their training.
- If the data isn't there, say so in one blunt line — never invent numbers.
- Give ONE clear call to action, not a menu of maybes.
- Keep it tight: 1-3 sentences unless they ask for depth. Land the point and stop.
- When nutrition data is present, use logged calories and protein alongside training/recovery. Do not treat missing meal days as zero intake.
- Units are pounds (lb) unless stated otherwise.`;

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  // Auth — the route guards itself; do not rely on a proxy redirect for an API.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { ok, retryAfter } = rateLimit(user.id, 20, 60_000);
  if (!ok) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const system =
    SYSTEM_PROMPT + (parsed.context ? `\n\nCONTEXT (the user's recent data):\n${parsed.context}` : "");

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
        "X-Title": APP_NAME,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...parsed.messages],
        max_tokens: 600,
        temperature: 0.6,
      }),
    });

    if (!res.ok) {
      // Log detail server-side; never leak provider errors to the client.
      console.error("OpenRouter error", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ error: "The coach is unavailable right now." }, { status: 502 });
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return NextResponse.json({ error: "Empty response from the coach." }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("ai-chat failed", err);
    return NextResponse.json({ error: "The coach is unavailable right now." }, { status: 502 });
  }
}

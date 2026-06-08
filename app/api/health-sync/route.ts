import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { upsertDailyHealth } from "@/lib/mutations";
import { rateLimit } from "@/lib/rate-limit";
import { APP_NAME } from "@/lib/constants";

// node:crypto + the service-role client require the Node.js runtime.
export const runtime = "nodejs";

/**
 * Watch-sync ingestion endpoint.
 *
 * A phone automation (e.g. Tasker reading Health Connect) POSTs a day's
 * metrics here. Auth is a shared bearer token, NOT a Supabase session — the
 * token holder never gets the service-role key. Two input shapes are accepted:
 *
 *   • Structured: { date?, steps?, active_kcal?, sleep_minutes?, ... }
 *       → validated and written directly. No AI call. Cheap and deterministic.
 *   • Raw:        { date?, raw: "<messy text / blob>" }
 *       → normalized by an LLM into the same shape, THEN validated. The model
 *         only proposes JSON; zod is the gate that decides what reaches the DB.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Every metric optional and bounded; zod strips unknown keys by default, so
// extra fields a phone automation tacks on are ignored rather than rejected.
// Coerce so a model (or automation) that returns "8432" as a string still
// validates. `.nullable()` short-circuits before coercion, so null stays null
// and omitted keys stay undefined — only real present values get Number()'d.
const int = (max: number) => z.coerce.number().int().min(0).max(max).nullable().optional();
const num = (max: number) => z.coerce.number().min(0).max(max).nullable().optional();

const MetricsSchema = z.object({
  steps: int(200_000),
  active_kcal: num(30_000),
  total_kcal: num(30_000),
  distance_m: num(1_000_000),
  sleep_minutes: int(1_440),
  resting_hr: int(250),
  avg_hr: int(250),
});
type Metrics = z.infer<typeof MetricsSchema>;

const RequestSchema = z
  .object({
    date: z.string().regex(DATE_RE).optional(),
    raw: z.string().min(1).max(20_000).optional(),
  })
  .passthrough();

/** Constant-time token comparison; false on any length mismatch. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the parsed metrics contain at least one usable value. */
function hasAnyMetric(m: Metrics): boolean {
  return Object.values(m).some((v) => v !== null && v !== undefined);
}

/** Today's date (server local) as YYYY-MM-DD, used when the client omits one. */
function serverToday(): string {
  return new Date().toLocaleDateString("en-CA"); // en-CA renders ISO YYYY-MM-DD
}

const NORMALIZE_PROMPT = `You convert messy health/fitness data into strict JSON.
Output ONLY a JSON object — no prose, no markdown, no code fences.
Allowed keys (all optional, omit any you cannot determine):
  steps          integer, whole-day step count
  active_kcal    number, active calories burned
  total_kcal     number, total calories burned
  distance_m     number, distance in METERS
  sleep_minutes  integer, total sleep in MINUTES
  resting_hr     integer, resting heart rate (bpm)
  avg_hr         integer, average heart rate (bpm)
Convert units as needed (km→meters, hours→minutes). Never invent values.`;

/** Ask the LLM to turn a raw blob into metric JSON. Validated by the caller. */
async function normalizeRaw(raw: string): Promise<Metrics> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set; cannot process a raw payload.");
  const model = process.env.HEALTH_SYNC_MODEL || "deepseek/deepseek-chat";

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
      messages: [
        { role: "system", content: NORMALIZE_PROMPT },
        { role: "user", content: raw },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty normalization response.");

  // Be tolerant of a model that wraps the object in prose or code fences:
  // pull out the first {...} block before parsing.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`No JSON object in normalization response: ${content.slice(0, 200)}`);
  }
  try {
    return MetricsSchema.parse(JSON.parse(content.slice(start, end + 1)));
  } catch (err) {
    // Surface the model's actual output server-side to make 422s debuggable.
    console.error("health-sync: normalization parse/validate failed", content.slice(0, 500));
    throw err;
  }
}

export async function POST(req: Request) {
  const expectedToken = process.env.HEALTH_SYNC_TOKEN;
  const userId = process.env.HEALTH_SYNC_USER_ID;
  if (!expectedToken || !userId) {
    return NextResponse.json({ error: "Sync is not configured." }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!provided || !tokensMatch(provided, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { ok, retryAfter } = rateLimit(`health-sync:${userId}`, 60, 60_000);
  if (!ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const recordedOn = body.date ?? serverToday();

  // Validate the metrics — directly when structured, via the LLM when raw.
  let metrics: Metrics;
  try {
    metrics =
      body.raw && body.raw.trim().length > 0
        ? await normalizeRaw(body.raw)
        : MetricsSchema.parse(body);
  } catch (err) {
    console.error("health-sync: could not derive metrics", err);
    return NextResponse.json({ error: "Could not read any metrics from the payload." }, { status: 422 });
  }

  if (!hasAnyMetric(metrics)) {
    return NextResponse.json({ error: "No metrics found in the payload." }, { status: 400 });
  }

  try {
    const sb = createSupabaseServiceClient();
    const saved = await upsertDailyHealth(sb, userId, { recorded_on: recordedOn, ...metrics });
    return NextResponse.json({
      ok: true,
      recorded_on: saved.recorded_on,
      synced_at: saved.synced_at,
    });
  } catch (err) {
    console.error("health-sync: write failed", err);
    return NextResponse.json({ error: "Could not save metrics." }, { status: 502 });
  }
}

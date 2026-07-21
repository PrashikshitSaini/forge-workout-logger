import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const RequestSchema = z.object({
  idempotency_key: z.string().uuid(),
  request_hash: z.string().min(16).max(128),
  text: z.string().trim().min(3).max(5000),
  logged_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  client_timezone: z.string().trim().min(1).max(100),
  meal_id: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  let body: z.infer<typeof RequestSchema>;
  try { body = RequestSchema.parse(await req.json()); } catch { return NextResponse.json({ error: "Describe the meal and choose a valid date." }, { status: 400 }); }
  const { data, error } = await supabase.rpc("enqueue_meal_research", {
    p_idempotency_key: body.idempotency_key,
    p_request_hash: body.request_hash,
    p_logged_on: body.logged_on,
    p_client_timezone: body.client_timezone,
    p_original_input: body.text,
    p_kind: body.meal_id ? "replace" : "create",
    p_target_meal_id: body.meal_id ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ ok: true, job: data }, { status: 202 });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data, error } = await supabase.from("meal_research_jobs").select("*").order("created_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ jobs: data ?? [] });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SaveSchema = z.object({ meal_id: z.string().uuid(), name: z.string().trim().min(2).max(120) });
const CopySchema = z.object({ reusable_id: z.string().uuid(), logged_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const HistorySchema = z.object({ source_meal_id: z.string().uuid(), logged_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const copy = CopySchema.safeParse(body);
  if (copy.success) {
    const { data, error } = await supabase.rpc("copy_meal_from_reusable", { p_reusable_id: copy.data.reusable_id, p_logged_on: copy.data.logged_on });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true, meal_id: data });
  }
  const history = HistorySchema.safeParse(body);
  if (history.success) {
    const { data, error } = await supabase.rpc("copy_meal_from_history", { p_source_meal_id: history.data.source_meal_id, p_logged_on: history.data.logged_on });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true, meal_id: data });
  }
  const save = SaveSchema.safeParse(body);
  if (!save.success) return NextResponse.json({ error: "Provide a meal and reusable name." }, { status: 400 });
  const { data, error } = await supabase.rpc("save_reusable_meal_from_meal", { p_meal_id: save.data.meal_id, p_name: save.data.name });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true, reusable: data });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data, error } = await supabase.from("reusable_meals").select("*").order("last_used_at", { ascending: false, nullsFirst: false }).limit(50);
  return error ? NextResponse.json({ error: error.message }, { status: 503 }) : NextResponse.json({ reusable_meals: data ?? [] });
}

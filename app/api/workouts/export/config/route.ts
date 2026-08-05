import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashWorkoutExportPassword } from "@/lib/workout-export-password";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SaveSchema = z.object({
  password: z.string().min(12).max(128),
  rotate_endpoint: z.boolean().optional().default(false),
});

async function currentUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("workout_export_credentials")
      .select("endpoint_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      configured: Boolean(data),
      endpoint_path: data ? `/api/workouts/export/${data.endpoint_id}` : null,
    });
  } catch (error) {
    console.error("workout-export-config: read failed", error);
    return NextResponse.json({ error: "Could not load export settings." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const parsed = SaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Use a password between 12 and 128 characters." }, { status: 400 });
  }

  try {
    const service = createSupabaseServiceClient();
    const { data: existing, error: readError } = await service
      .from("workout_export_credentials")
      .select("endpoint_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw readError;
    const endpointId = !existing || parsed.data.rotate_endpoint ? randomUUID() : existing.endpoint_id;
    const { error } = await service.from("workout_export_credentials").upsert(
      {
        user_id: user.id,
        endpoint_id: endpointId,
        password_hash: await hashWorkoutExportPassword(parsed.data.password),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true, endpoint_path: `/api/workouts/export/${endpointId}` });
  } catch (error) {
    console.error("workout-export-config: write failed", error);
    return NextResponse.json({ error: "Could not save export settings." }, { status: 502 });
  }
}

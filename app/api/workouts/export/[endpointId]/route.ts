import { NextResponse } from "next/server";
import { z } from "zod";
import { buildWorkoutExport, type ExportSession } from "@/lib/workout-export";
import { verifyWorkoutExportPassword } from "@/lib/workout-export-password";
import { rateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QuerySchema = z.object({ from: z.string().regex(DATE_RE).optional(), to: z.string().regex(DATE_RE).optional() });
const EndpointSchema = z.string().uuid();
const PAGE_SIZE = 500;
const SESSION_EXPORT_SELECT =
  "id, performed_on, notes, finished_at, created_at, regime:regimes(id, name, started_on, ended_on), routine:routines(id, name, day_of_week, position), session_exercises(id, position, notes, created_at, exercise:exercises(id, name, muscle_group, equipment, type), sets(id, set_number, weight, reps, rpe, duration_seconds, level, done, created_at))";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function basicPassword(header: string): string | null {
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0 ? decoded.slice(separator + 1) : null;
  } catch {
    return null;
  }
}

/** Read-only personal export, protected by a password set in the Settings UI. */
export async function GET(request: Request, context: { params: Promise<{ endpointId: string }> }) {
  const { endpointId } = await context.params;
  if (!EndpointSchema.safeParse(endpointId).success) return noStoreJson({ error: "Unauthorized." }, { status: 401 });

  const limited = rateLimit(`workout-export:${endpointId}`, 10, 60_000);
  if (!limited.ok) {
    return noStoreJson({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  }

  const password = basicPassword(request.headers.get("authorization") ?? "");
  if (!password) {
    return noStoreJson({ error: "Unauthorized." }, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Forge workout export"' } });
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    return noStoreJson({ error: "Use YYYY-MM-DD dates with from no later than to." }, { status: 400 });
  }

  try {
    const service = createSupabaseServiceClient();
    const { data: credential, error: credentialError } = await service
      .from("workout_export_credentials")
      .select("user_id, password_hash")
      .eq("endpoint_id", endpointId)
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential || !(await verifyWorkoutExportPassword(password, credential.password_hash))) {
      return noStoreJson({ error: "Unauthorized." }, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Forge workout export"' } });
    }

    const rows: ExportSession[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = service.from("sessions").select(SESSION_EXPORT_SELECT).eq("user_id", credential.user_id)
        .order("performed_on", { ascending: false }).order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      if (parsed.data.from) query = query.gte("performed_on", parsed.data.from);
      if (parsed.data.to) query = query.lte("performed_on", parsed.data.to);
      const { data, error } = await query;
      if (error) throw error;
      const page = (data ?? []) as unknown as ExportSession[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return noStoreJson(buildWorkoutExport(rows, { from: parsed.data.from ?? null, to: parsed.data.to ?? null }));
  } catch (error) {
    console.error("workout-export: read failed", error);
    return noStoreJson({ error: "Could not load workout export." }, { status: 502 });
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Close stale sessions for exactly one user; this is intentionally access-driven, not a background job. */
export async function finishStaleSessions(
  sb: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<void> {
  const finishedAt = now.toISOString();
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const { error } = await sb
    .from("sessions")
    .update({ finished_at: finishedAt })
    .eq("user_id", userId)
    .is("finished_at", null)
    .lte("created_at", cutoff);
  if (error) throw error;
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Privileged Supabase client that BYPASSES Row-Level Security.
 *
 * SERVER-ONLY. Never import this into a client component or expose the
 * service-role key to the browser. Use it only in trusted server contexts
 * (e.g. the token-authenticated /api/health-sync endpoint) where the row's
 * user_id is set explicitly server-side and never taken from the request body.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");

  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, assertSupabaseConfigured } from "./env";

let cached: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Browser Supabase client, memoized as a single instance (Supabase's
 * recommendation). Used by client components for all reads/writes; Row-Level
 * Security keys every row to the signed-in user, so the anon key is safe here.
 */
export function createSupabaseBrowserClient() {
  assertSupabaseConfigured();
  if (!cached) cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}

"use client";

import { createBrowserClient } from "@supabase/ssr";

import { appEnv } from "@/lib/env";

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    appEnv.supabaseUrl || "https://example.supabase.co",
    appEnv.supabaseAnonKey || "public-anon-key",
    { db: { schema: "lumen" } },
  );
}

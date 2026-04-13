import { createClient } from "@supabase/supabase-js";

import { appEnv, hasAdminSupabaseConfig } from "@/lib/env";

export function createAdminSupabaseClient() {
  if (!hasAdminSupabaseConfig()) {
    return null;
  }

  return createClient(appEnv.supabaseUrl!, appEnv.supabaseServiceRoleKey!, {
    db: { schema: "lumen" },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

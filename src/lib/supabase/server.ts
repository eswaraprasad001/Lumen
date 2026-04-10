import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { appEnv } from "@/lib/env";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    appEnv.supabaseUrl || "https://example.supabase.co",
    appEnv.supabaseAnonKey || "public-anon-key",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items) {
          try {
            items.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server components may not be able to mutate cookies during render.
          }
        },
      },
    },
  );
}

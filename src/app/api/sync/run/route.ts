import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";
import { runSync } from "@/lib/data";

const RATE_LIMIT_SECONDS = 60;

export async function POST() {
  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  // Rate-limit: reject if a sync ran within the last RATE_LIMIT_SECONDS for this user.
  // Only enforced in live mode (when Supabase is configured and user is authenticated).
  if (user && hasSupabaseConfig()) {
    const supabase = await createServerSupabaseClient();
    const { data: account } = await supabase
      .from("email_accounts")
      .select("last_synced_at")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .maybeSingle();

    if (account?.last_synced_at) {
      const secondsAgo =
        (Date.now() - new Date(account.last_synced_at).getTime()) / 1000;
      if (secondsAgo < RATE_LIMIT_SECONDS) {
        const retryAfter = Math.ceil(RATE_LIMIT_SECONDS - secondsAgo);
        return NextResponse.json(
          { ok: false, error: `Sync is rate-limited. Try again in ${retryAfter}s.` },
          {
            status: 429,
            headers: { "Retry-After": String(retryAfter) },
          },
        );
      }
    }
  }

  const result = await runSync();
  return NextResponse.json(result, {
    status: result.ok ? 200 : 400,
  });
}

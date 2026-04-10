"use client";

import { startTransition, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);
  const disabled = !process.env.NEXT_PUBLIC_SUPABASE_URL;

  async function handleClick() {
    if (disabled || loading) return;

    startTransition(async () => {
      setLoading(true);

      const supabase = createBrowserSupabaseClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });
    });
  }

  return (
    <button className="button" onClick={handleClick} disabled={disabled || loading}>
      {disabled ? "Supabase env required" : loading ? "Redirecting..." : "Sign in with Google"}
    </button>
  );
}

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { hasSupabaseConfig } from "@/lib/env";
import { getCurrentUser } from "@/lib/data";

/**
 * Enforce that the user is authenticated when Supabase is configured.
 * Returns the user object or null when auth is not required (e.g. demo mode).
 */
export async function requireAuth() {
  if (!hasSupabaseConfig()) return null;

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return user;
}

/**
 * Convenience helper for pages that need to know if auth is required.
 */
export function authIsRequired() {
  return hasSupabaseConfig();
}

/**
 * Auth guard for API route handlers. Returns the user or an unauthorized response.
 * Usage:
 *   const { user, unauthorized } = await requireApiAuth();
 *   if (unauthorized) return unauthorized;
 */
export async function requireApiAuth(): Promise<
  | { user: Awaited<ReturnType<typeof getCurrentUser>>; unauthorized: null }
  | { user: null; unauthorized: NextResponse }
> {
  if (!hasSupabaseConfig()) {
    // Demo mode — no auth required; caller gets null user and no error
    return { user: null, unauthorized: null };
  }
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }
  return { user, unauthorized: null };
}


import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { startGmailConnection } from "@/lib/data";

export async function POST() {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const result = await startGmailConnection();
  if (!result.ok || !result.url || !result.state) {
    return NextResponse.json(result, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set("gmail_oauth_state", result.state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return NextResponse.json({ url: result.url });
}

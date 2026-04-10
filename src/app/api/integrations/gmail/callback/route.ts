import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { appEnv } from "@/lib/env";
import { completeGmailConnection } from "@/lib/data";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("gmail_oauth_state")?.value;

  if (!code || !state || !expectedState || expectedState !== state) {
    return NextResponse.redirect(
      new URL("/settings?gmail=error", appEnv.appUrl),
    );
  }

  try {
    await completeGmailConnection(code);
    cookieStore.delete("gmail_oauth_state");
    return NextResponse.redirect(
      new URL("/settings?gmail=connected", appEnv.appUrl),
    );
  } catch {
    return NextResponse.redirect(
      new URL("/settings?gmail=error", appEnv.appUrl),
    );
  }
}

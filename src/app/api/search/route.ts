import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { searchMessages } from "@/lib/data";

export async function GET(request: NextRequest) {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const data = await searchMessages(q);
  return NextResponse.json(data);
}

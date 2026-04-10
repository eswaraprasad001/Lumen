import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { disconnectGmail } from "@/lib/data";

export async function DELETE() {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const result = await disconnectGmail();
  return NextResponse.json(result, {
    status: result.ok ? 200 : 400,
  });
}

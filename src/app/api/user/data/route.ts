import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { deleteUserData } from "@/lib/data";

export async function DELETE() {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const result = await deleteUserData();
  return NextResponse.json(result, {
    status: result.ok ? 200 : 400,
  });
}

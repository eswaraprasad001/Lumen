import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { getSourcesData } from "@/lib/data";

export async function GET() {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  return NextResponse.json(await getSourcesData());
}

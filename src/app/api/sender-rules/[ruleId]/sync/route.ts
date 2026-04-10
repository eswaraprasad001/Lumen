import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { hasSupabaseConfig } from "@/lib/env";
import { runSyncForRule } from "@/lib/data";

type RouteProps = {
  params: Promise<{ ruleId: string }>;
};

export async function POST(req: Request, { params }: RouteProps) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 400 });
  }

  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { ruleId } = await params;
  const { mode } = (await req.json()) as { mode: "catchup" | "fresh" };

  if (mode !== "catchup" && mode !== "fresh") {
    return NextResponse.json({ ok: false, error: "mode must be 'catchup' or 'fresh'." }, { status: 400 });
  }

  const result = await runSyncForRule(ruleId, mode);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

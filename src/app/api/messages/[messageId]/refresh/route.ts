import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { refreshMessageContent } from "@/lib/data";

type RouteProps = { params: Promise<{ messageId: string }> };

export async function POST(_: Request, { params }: RouteProps) {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { messageId } = await params;
  const result = await refreshMessageContent(messageId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

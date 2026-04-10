import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth";
import { updateMessageState } from "@/lib/data";

const payloadSchema = z.object({
  state: z
    .enum(["new", "opened", "in_progress", "saved", "finished", "archived"])
    .optional(),
  progressPercent: z.number().min(0).max(100).optional(),
  saved: z.boolean().optional(),
  archived: z.boolean().optional(),
  lastScrollPosition: z.number().min(0).optional(),
});

type RouteProps = {
  params: Promise<{ messageId: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { messageId } = await params;

  let body: z.infer<typeof payloadSchema>;
  try {
    body = payloadSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Invalid payload." },
      { status: 400 },
    );
  }

  const result = await updateMessageState(messageId, body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

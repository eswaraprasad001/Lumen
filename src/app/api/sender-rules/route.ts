import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth";
import { createSenderRule } from "@/lib/data";

const payloadSchema = z.object({
  ruleType: z.enum(["sender_email", "sender_domain"]),
  value: z.string().min(3),
  action: z.enum(["include", "exclude"]),
  sourceLabel: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const body = payloadSchema.parse(await request.json());
  const result = await createSenderRule(body);

  return NextResponse.json(result, {
    status: result.ok ? 200 : 400,
  });
}

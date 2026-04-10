import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { deleteMessage, getMessageData } from "@/lib/data";

type RouteProps = {
  params: Promise<{ messageId: string }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { messageId } = await params;
  const message = await getMessageData(messageId);

  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  return NextResponse.json(message);
}

export async function DELETE(_: Request, { params }: RouteProps) {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { messageId } = await params;
  const result = await deleteMessage(messageId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

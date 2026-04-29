import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";

type RouteProps = { params: Promise<{ folderId: string }> };

export async function POST(req: Request, { params }: RouteProps) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 400 });
  }

  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { folderId } = await params;
  const { messageId } = (await req.json()) as { messageId?: string };
  if (!messageId) {
    return NextResponse.json({ ok: false, error: "messageId is required." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Verify folder belongs to this user
  const { data: folder } = await supabase
    .from("saved_folders")
    .select("id")
    .eq("id", folderId)
    .eq("user_id", user!.id)
    .single();

  if (!folder) {
    return NextResponse.json({ ok: false, error: "Folder not found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("message_folder_items")
    .upsert(
      { folder_id: folderId, message_id: messageId, user_id: user!.id },
      { onConflict: "folder_id,message_id" },
    );

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: RouteProps) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 400 });
  }

  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { folderId } = await params;
  const { messageId } = (await req.json()) as { messageId?: string };
  if (!messageId) {
    return NextResponse.json({ ok: false, error: "messageId is required." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("message_folder_items")
    .delete()
    .eq("folder_id", folderId)
    .eq("message_id", messageId)
    .eq("user_id", user!.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

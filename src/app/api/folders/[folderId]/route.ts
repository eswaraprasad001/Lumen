import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";

type RouteProps = { params: Promise<{ folderId: string }> };

export async function PATCH(req: Request, { params }: RouteProps) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 400 });
  }

  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { folderId } = await params;
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ ok: false, error: "Folder name is required." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("saved_folders")
    .update({ name: name.trim() })
    .eq("id", folderId)
    .eq("user_id", user!.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: RouteProps) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 400 });
  }

  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { folderId } = await params;
  const supabase = await createServerSupabaseClient();

  // Junction rows cascade via FK — just delete the folder
  const { error } = await supabase
    .from("saved_folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", user!.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

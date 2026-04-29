import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";

export async function GET() {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ folders: [] });
  }

  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const supabase = await createServerSupabaseClient();

  const [{ data: folders }, { data: countRows }] = await Promise.all([
    supabase
      .from("saved_folders")
      .select("id, name, created_at")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("message_folder_items")
      .select("folder_id")
      .eq("user_id", user!.id),
  ]);

  const countMap = new Map<string, number>();
  for (const row of countRows ?? []) {
    countMap.set(row.folder_id, (countMap.get(row.folder_id) ?? 0) + 1);
  }

  return NextResponse.json({
    folders: (folders ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      messageCount: countMap.get(f.id) ?? 0,
      createdAt: f.created_at,
    })),
  });
}

export async function POST(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 400 });
  }

  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ ok: false, error: "Folder name is required." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("saved_folders")
    .insert({ user_id: user!.id, name: name.trim() })
    .select("id, name, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed to create folder." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, folder: { id: data.id, name: data.name, messageCount: 0, createdAt: data.created_at } });
}

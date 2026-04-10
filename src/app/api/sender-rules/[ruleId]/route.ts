import { NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";

type RouteProps = {
  params: Promise<{ ruleId: string }>;
};

export async function PATCH(req: Request, { params }: RouteProps) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 400 });
  }

  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { ruleId } = await params;
  const body = (await req.json()) as { sourceLabel?: string; active?: boolean };
  const supabase = await createServerSupabaseClient();

  const update: Record<string, unknown> = {};
  if ("sourceLabel" in body) update.source_label = body.sourceLabel || null;
  if ("active" in body) update.active = body.active;

  const { error } = await supabase
    .from("sender_rules")
    .update(update)
    .eq("id", ruleId)
    .eq("user_id", user!.id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Rule updated." });
}

export async function DELETE(_: Request, { params }: RouteProps) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured." },
      { status: 400 },
    );
  }

  const { user, unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const { ruleId } = await params;
  const supabase = await createServerSupabaseClient();

  // Fetch the rule so we know the value/type to find the matching source
  const { data: rule, error: ruleError } = await supabase
    .from("sender_rules")
    .select("value, rule_type")
    .eq("id", ruleId)
    .eq("user_id", user!.id)
    .single();

  if (ruleError || !rule) {
    return NextResponse.json({ ok: false, error: "Rule not found." }, { status: 404 });
  }

  // Find the matching newsletter_source
  const matchColumn =
    rule.rule_type === "sender_domain"
      ? "normalized_sender_domain"
      : "normalized_sender_email";

  const { data: source } = await supabase
    .from("newsletter_sources")
    .select("id")
    .eq("user_id", user!.id)
    .eq(matchColumn, rule.value.toLowerCase())
    .maybeSingle();

  // Delete the newsletter_source — messages cascade via FK
  if (source) {
    await supabase
      .from("newsletter_sources")
      .delete()
      .eq("id", source.id)
      .eq("user_id", user!.id);
  }

  // Delete the rule
  const { error } = await supabase
    .from("sender_rules")
    .delete()
    .eq("id", ruleId)
    .eq("user_id", user!.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message: "Rule and associated content deleted." });
}

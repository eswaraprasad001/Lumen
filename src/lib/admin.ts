import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/data";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type AdminUserRow = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  messageCount: number;
  ruleCount: number;
  lastSyncAt: string | null;
  gmailConnected: boolean;
};

export type DayStat = { date: string; count: number };

export type ReadingStateCounts = {
  new: number;
  opened: number;
  in_progress: number;
  finished: number;
  saved: number;
  archived: number;
};

export type TopSource = {
  domain: string;
  name: string;
  userCount: number;
  messageCount: number;
};

export type AdminDashboardData = {
  totalUsers: number;
  activeUsers7d: number;
  totalMessages: number;
  totalRules: number;
  gmailConnectedCount: number;
  avgMessagesPerUser: number;
  signupsLast30d: DayStat[];
  messagesLast30d: DayStat[];
  readingStates: ReadingStateCounts;
  topSources: TopSource[];
  users: AdminUserRow[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDayBuckets(days: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  return map;
}

function isoToDay(iso: string) {
  return iso.slice(0, 10);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function requireAdminPage(): Promise<void> {
  if (!hasSupabaseConfig()) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const adminClient = createAdminSupabaseClient();
  if (!adminClient) redirect("/");
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "super_admin") redirect("/");
}

export async function isAdmin(): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const user = await getCurrentUser();
  if (!user) return false;
  const adminClient = createAdminSupabaseClient();
  if (!adminClient) return false;
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.role === "super_admin";
}

// ── Data ──────────────────────────────────────────────────────────────────────

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const adminClient = createAdminSupabaseClient();
  if (!adminClient) {
    return {
      totalUsers: 0, activeUsers7d: 0, totalMessages: 0, totalRules: 0,
      gmailConnectedCount: 0, avgMessagesPerUser: 0,
      signupsLast30d: [], messagesLast30d: [],
      readingStates: { new: 0, opened: 0, in_progress: 0, finished: 0, saved: 0, archived: 0 },
      topSources: [], users: [],
    };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    { data: authData },
    { data: msgCountRows },
    { data: ruleRows },
    { data: accountRows },
    { data: stateCounts },
    { data: msgPerDay },
    { data: topSourceRows },
    { count: totalMessages },
    { count: totalRules },
  ] = await Promise.all([
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
    // Per-user message counts (lightweight — only user_id)
    adminClient.from("messages").select("user_id"),
    adminClient.from("sender_rules").select("user_id"),
    adminClient.from("email_accounts").select("user_id, last_synced_at, provider"),
    // Aggregated via RPC — no full table scan in JS
    adminClient.rpc("admin_reading_state_counts"),
    adminClient.rpc("admin_messages_per_day", { days_back: 30 }),
    adminClient.rpc("admin_top_sources", { limit_n: 8 }),
    adminClient.from("messages").select("*", { count: "exact", head: true }),
    adminClient.from("sender_rules").select("*", { count: "exact", head: true }),
  ]);

  const authUsers = (authData as { users: { id: string; email?: string; created_at: string; last_sign_in_at?: string }[] } | null)?.users ?? [];

  // ── Per-user maps ────────────────────────────────────────────────────────────
  const msgCountMap = new Map<string, number>();
  for (const row of msgCountRows ?? []) {
    msgCountMap.set(row.user_id, (msgCountMap.get(row.user_id) ?? 0) + 1);
  }

  const ruleCountMap = new Map<string, number>();
  for (const row of ruleRows ?? []) {
    ruleCountMap.set(row.user_id, (ruleCountMap.get(row.user_id) ?? 0) + 1);
  }

  const syncMap = new Map<string, { lastSyncAt: string | null; connected: boolean }>();
  for (const row of accountRows ?? []) {
    if (row.provider === "gmail") {
      syncMap.set(row.user_id, { lastSyncAt: row.last_synced_at ?? null, connected: true });
    }
  }

  // ── User rows ────────────────────────────────────────────────────────────────
  const users: AdminUserRow[] = authUsers.map((u) => ({
    id: u.id,
    email: u.email ?? "(no email)",
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    messageCount: msgCountMap.get(u.id) ?? 0,
    ruleCount: ruleCountMap.get(u.id) ?? 0,
    lastSyncAt: syncMap.get(u.id)?.lastSyncAt ?? null,
    gmailConnected: syncMap.get(u.id)?.connected ?? false,
  }));

  const activeUsers7d = users.filter((u) => u.lastSyncAt && u.lastSyncAt > sevenDaysAgo).length;
  const gmailConnectedCount = users.filter((u) => u.gmailConnected).length;
  const total = totalMessages ?? 0;
  const avgMessagesPerUser = authUsers.length > 0 ? Math.round(total / authUsers.length) : 0;

  // ── Signups last 30 days (still from auth — no DB aggregate available) ────────
  const signupBuckets = buildDayBuckets(30);
  for (const u of authUsers) {
    const day = isoToDay(u.created_at);
    if (signupBuckets.has(day)) signupBuckets.set(day, (signupBuckets.get(day) ?? 0) + 1);
  }
  const signupsLast30d: DayStat[] = [...signupBuckets.entries()].map(([date, count]) => ({ date, count }));

  // ── Messages per day — from RPC ───────────────────────────────────────────────
  const msgBuckets = buildDayBuckets(30);
  for (const row of (msgPerDay ?? []) as Array<{ day: string; cnt: number }>) {
    const day = row.day.slice(0, 10);
    if (msgBuckets.has(day)) msgBuckets.set(day, row.cnt);
  }
  const messagesLast30d: DayStat[] = [...msgBuckets.entries()].map(([date, count]) => ({ date, count }));

  // ── Reading states — from RPC ─────────────────────────────────────────────────
  const readingStates: ReadingStateCounts = {
    new: 0,
    opened: 0,
    in_progress: 0,
    finished: 0,
    saved: 0,
    archived: 0,
  };
  for (const row of (stateCounts ?? []) as Array<{ state: string; cnt: number }>) {
    if (row.state in readingStates) (readingStates as Record<string, number>)[row.state] = row.cnt;
  }

  // ── Top sources — from RPC ────────────────────────────────────────────────────
  const topSources: TopSource[] = ((topSourceRows ?? []) as Array<{ domain: string; name: string; user_count: number; msg_count: number }>)
    .map((r) => ({
      domain: r.domain,
      name: r.name ?? r.domain,
      userCount: r.user_count,
      messageCount: r.msg_count,
    }));

  return {
    totalUsers: authUsers.length,
    activeUsers7d,
    totalMessages: total,
    totalRules: totalRules ?? 0,
    gmailConnectedCount,
    avgMessagesPerUser,
    signupsLast30d,
    messagesLast30d,
    readingStates,
    topSources,
    users: users.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

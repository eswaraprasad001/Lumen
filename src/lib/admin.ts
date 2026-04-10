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
  saved: number;
  finished: number;
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
      readingStates: { new: 0, opened: 0, in_progress: 0, saved: 0, finished: 0, archived: 0 },
      topSources: [], users: [],
    };
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const sevenDaysAgo  = new Date(Date.now() -  7 * 86400000).toISOString();

  const [
    { data: authData },
    { data: msgRows },
    { data: recentMsgRows },
    { data: ruleRows },
    { data: accountRows },
    { data: stateRows },
    { data: sourceRows },
  ] = await Promise.all([
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
    adminClient.from("messages").select("user_id, received_at"),
    adminClient.from("messages").select("received_at").gte("received_at", thirtyDaysAgo),
    adminClient.from("sender_rules").select("user_id, action"),
    adminClient.from("email_accounts").select("user_id, last_synced_at, provider"),
    adminClient.from("user_message_states").select("state"),
    adminClient.from("newsletter_sources").select("user_id, normalized_sender_domain, display_name"),
  ]);

  const authUsers = (authData as { users: { id: string; email?: string; created_at: string; last_sign_in_at?: string }[] } | null)?.users ?? [];

  // ── Per-user maps ────────────────────────────────────────────────────────────
  const msgCountMap = new Map<string, number>();
  for (const row of msgRows ?? []) {
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
  const totalMessages = msgRows?.length ?? 0;
  const avgMessagesPerUser = authUsers.length > 0 ? Math.round(totalMessages / authUsers.length) : 0;

  // ── Signups last 30 days ─────────────────────────────────────────────────────
  const signupBuckets = buildDayBuckets(30);
  for (const u of authUsers) {
    const day = isoToDay(u.created_at);
    if (signupBuckets.has(day)) signupBuckets.set(day, (signupBuckets.get(day) ?? 0) + 1);
  }
  const signupsLast30d: DayStat[] = [...signupBuckets.entries()].map(([date, count]) => ({ date, count }));

  // ── Messages received last 30 days ───────────────────────────────────────────
  const msgBuckets = buildDayBuckets(30);
  for (const row of recentMsgRows ?? []) {
    const day = isoToDay(row.received_at);
    if (msgBuckets.has(day)) msgBuckets.set(day, (msgBuckets.get(day) ?? 0) + 1);
  }
  const messagesLast30d: DayStat[] = [...msgBuckets.entries()].map(([date, count]) => ({ date, count }));

  // ── Reading states ────────────────────────────────────────────────────────────
  const readingStates: ReadingStateCounts = { new: 0, opened: 0, in_progress: 0, saved: 0, finished: 0, archived: 0 };
  for (const row of stateRows ?? []) {
    if (row.state in readingStates) (readingStates as Record<string, number>)[row.state]++;
  }

  // ── Top sources ───────────────────────────────────────────────────────────────
  const domainUserSet  = new Map<string, Set<string>>();
  const domainMsgCount = new Map<string, number>();
  const domainName     = new Map<string, string>();
  for (const row of sourceRows ?? []) {
    const d = row.normalized_sender_domain ?? "unknown";
    if (!domainUserSet.has(d)) domainUserSet.set(d, new Set());
    domainUserSet.get(d)!.add(row.user_id);
    if (row.display_name) domainName.set(d, row.display_name);
  }
  for (const row of msgRows ?? []) {
    // We need domain per message — use source lookup via sourceRows
  }
  // Build message count per domain via sourceRows × msgRows (source_id not available here — use userCount as proxy)
  const topSources: TopSource[] = [...domainUserSet.entries()]
    .map(([domain, userSet]) => ({
      domain,
      name: domainName.get(domain) ?? domain,
      userCount: userSet.size,
      messageCount: domainMsgCount.get(domain) ?? 0,
    }))
    .sort((a, b) => b.userCount - a.userCount)
    .slice(0, 8);

  return {
    totalUsers: authUsers.length,
    activeUsers7d,
    totalMessages,
    totalRules: ruleRows?.length ?? 0,
    gmailConnectedCount,
    avgMessagesPerUser,
    signupsLast30d,
    messagesLast30d,
    readingStates,
    topSources,
    users: users.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

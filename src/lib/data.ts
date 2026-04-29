import { cache } from "react";

import { appEnv, hasAdminSupabaseConfig, hasGmailConfig, hasSupabaseConfig } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { ParsedGmailMessage } from "@/lib/gmail";
import {
  HomeData,
  LibraryData,
  MessageRecord,
  MessageState,
  SenderRule,
  SettingsData,
  SourceDetailData,
  SourceRecord,
  SourcesData,
} from "@/lib/types";
import { estimateReadMinutes, normalizeDomain, normalizeSenderEmail } from "@/lib/utils";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RuntimeMode = "setup" | "live";

type DbMessageRow = {
  id: string;
  source_id: string;
  subject: string;
  from_name: string | null;
  from_email: string;
  snippet: string | null;
  sent_at: string;
  received_at: string;
  unsubscribe_url: string | null;
  state: MessageState;
  progress_percent: number;
  saved: boolean;
  archived: boolean;
  last_scroll_position: number;
  newsletter_sources?: {
    id: string;
    display_name: string | null;
    category: string | null;
    logo_url: string | null;
  } | null;
  message_bodies?: Array<{
    sanitized_html_content: string | null;
    text_content: string | null;
    extracted_readable_text: string | null;
  }> | null;
};

const getRuntimeMode = cache(async function getRuntimeMode(): Promise<RuntimeMode> {
  return hasSupabaseConfig() ? "live" : "setup";
});

export const getCurrentUser = cache(async function getCurrentUser() {
  if (!hasSupabaseConfig()) return null;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

function mapDbMessage(row: DbMessageRow): MessageRecord {
  const bodyRaw = row.message_bodies;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = Array.isArray(bodyRaw) ? bodyRaw[0] : (bodyRaw as any);
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.newsletter_sources?.display_name || row.from_name || row.from_email,
    subject: row.subject,
    fromName: row.from_name || row.from_email,
    fromEmail: row.from_email,
    snippet: row.snippet || "",
    category: row.newsletter_sources?.category,
    receivedAt: row.received_at,
    sentAt: row.sent_at,
    state: row.state || "new",
    progressPercent: row.progress_percent || 0,
    saved: Boolean(row.saved),
    archived: Boolean(row.archived),
    sanitizedHtmlContent: body?.sanitized_html_content,
    textContent: body?.text_content,
    extractedReadableText: body?.extracted_readable_text,
    unsubscribeUrl: row.unsubscribe_url,
    estimatedReadMinutes: estimateReadMinutes(
      body?.extracted_readable_text || body?.text_content || row.snippet || "",
    ),
    lastScrollPosition: row.last_scroll_position || 0,
    logoUrl: row.newsletter_sources?.logo_url ?? null,
    bodyExpired:
      !body?.sanitized_html_content &&
      !body?.text_content &&
      !body?.extracted_readable_text &&
      (Date.now() - new Date(row.received_at).getTime()) / 86400000 > appEnv.retentionDays,
  };
}

async function getLiveMessageById(messageId: string) {
  const user = await getCurrentUser();
  if (!user) return null;

  // Use admin client so message_bodies join isn't blocked by RLS
  // (user_id column may not be backfilled). User ownership is enforced
  // by the .eq("user_id", user.id) filter on the messages table.
  const admin = createAdminSupabaseClient();
  const supabase = admin ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("messages")
    .select(
      `
        id, source_id, subject, from_name, from_email, snippet,
        sent_at, received_at, unsubscribe_url,
        state, progress_percent, saved, archived, last_scroll_position,
        newsletter_sources(id, display_name, category, logo_url),
        message_bodies(sanitized_html_content, text_content, extracted_readable_text)
      `,
    )
    .eq("user_id", user.id)
    .eq("id", messageId)
    .maybeSingle();

  if (error || !data) return null;
  const base = mapDbMessage(data as unknown as DbMessageRow);

  if (!base.sanitizedHtmlContent && !base.textContent && !base.extractedReadableText) {
    // The user-auth join may be blocked by RLS (e.g. user_id column not yet
    // backfilled). Use the admin client to fetch the body directly — message
    // ownership is already confirmed by the query above.
    const admin = createAdminSupabaseClient();
    const bodyClient = admin ?? supabase;

    const { data: bodyRows } = await bodyClient
      .from("message_bodies")
      .select("sanitized_html_content, text_content, extracted_readable_text")
      .eq("message_id", messageId)
      .limit(1);

    const body = bodyRows?.[0];
    if (body) {
      return {
        ...base,
        sanitizedHtmlContent: body.sanitized_html_content,
        textContent: body.text_content,
        extractedReadableText: body.extracted_readable_text,
      } satisfies MessageRecord;
    }
  }

  return base;
}

export async function refreshMessageContent(messageId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const admin = createAdminSupabaseClient();
  if (!admin) return { ok: false, error: "Admin client unavailable." };

  // Get the provider_message_id so we can re-fetch from Gmail
  const { data: msgRow } = await admin
    .from("messages")
    .select("provider_message_id, email_account_id")
    .eq("id", messageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!msgRow) return { ok: false, error: "Message not found." };

  // Get Gmail credentials
  const { data: account } = await admin
    .from("email_accounts")
    .select("id, access_token_encrypted, refresh_token_encrypted")
    .eq("id", msgRow.email_account_id)
    .maybeSingle();

  if (!account) return { ok: false, error: "Email account not found." };

  const accessToken = decryptSecret(account.access_token_encrypted);
  const refreshToken = account.refresh_token_encrypted
    ? decryptSecret(account.refresh_token_encrypted)
    : null;

  // Get sender rules so detection still works
  const { data: ruleRows } = await admin
    .from("sender_rules")
    .select("rule_type, value, action")
    .eq("user_id", user.id);

  const rules = (ruleRows ?? []).map((r) => ({
    ruleType: r.rule_type as "sender_email" | "sender_domain",
    value: r.value,
    action: r.action as "include" | "exclude",
  }));

  const { refetchGmailMessage } = await import("@/lib/gmail");
  const parsed = await refetchGmailMessage(accessToken, refreshToken, msgRow.provider_message_id, rules);
  if (!parsed) return { ok: false, error: "Gmail returned no content." };

  await admin.from("message_bodies").upsert(
    {
      message_id: messageId,
      user_id: user.id,
      html_content: parsed.sanitizedHtmlContent,
      text_content: parsed.textContent,
      sanitized_html_content: parsed.sanitizedHtmlContent,
      extracted_readable_text: parsed.extractedReadableText,
    },
    { onConflict: "message_id" },
  );

  return { ok: true };
}

const getLiveSources = cache(async function getLiveSources(): Promise<SourceRecord[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createServerSupabaseClient();

  const [{ data, error }, { data: rules }] = await Promise.all([
    supabase
      .from("newsletter_sources")
      .select(
        "id, display_name, normalized_sender_email, normalized_sender_domain, description, category, include_rule, exclude_rule, priority_level, last_seen_at, message_count",
      )
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false }),
    // Issue 8: use FK source_id on sender_rules instead of string matching
    supabase
      .from("sender_rules")
      .select("id, source_id, source_label, active")
      .eq("user_id", user.id),
  ]);

  if (error || !data) return [];

  // Build rule lookup by source_id (FK — no string matching needed)
  const ruleBySourceId = new Map(
    (rules ?? [])
      .filter((r) => r.source_id)
      .map((r) => [r.source_id as string, { id: r.id, label: r.source_label, active: r.active as boolean }]),
  );

  return data.map((row) => {
    const matchedRule = ruleBySourceId.get(row.id) ?? null;
    return {
      id: row.id,
      displayName: row.display_name || row.normalized_sender_domain,
      senderEmail: row.normalized_sender_email,
      senderDomain: row.normalized_sender_domain,
      description: row.description,
      category: row.category,
      includeRule: row.include_rule,
      excludeRule: row.exclude_rule,
      priorityLevel: row.priority_level,
      messageCount: row.message_count ?? 0,
      lastReceivedAt: row.last_seen_at,
      ruleId: matchedRule?.id ?? null,
      ruleLabel: matchedRule?.label ?? null,
      ruleActive: matchedRule?.active ?? null,
    };
  }) satisfies SourceRecord[];
});

export async function getHomeData() {
  const mode = await getRuntimeMode();

  if (mode === "setup") {
    return {
      mode,
      newItems: [],
      newItemsTotal: 0,
      continueReading: [],
      selectedSourceItems: [],
      savedItems: [],
      recentlyRead: [],
      isNewUser: false,
    } satisfies HomeData;
  }

  const user = await getCurrentUser();
  if (!user) {
    return {
      mode,
      newItems: [],
      newItemsTotal: 0,
      continueReading: [],
      selectedSourceItems: [],
      savedItems: [],
      recentlyRead: [],
      isNewUser: false,
    } satisfies HomeData;
  }

  const supabase = await createServerSupabaseClient();

  const MSG_SELECT = `
    id, source_id, subject, from_name, from_email, snippet,
    sent_at, received_at, unsubscribe_url,
    state, progress_percent, saved, archived, last_scroll_position,
    newsletter_sources(id, display_name, category, logo_url)
  `;

  // Run all queries in parallel — each is a targeted index scan
  const [
    { count: accountCount },
    { count: ruleCount },
    { count: newItemsTotal },
    { data: newRows },
    { data: continueRows },
    { data: recentlyReadRows },
    { data: savedRows },
    { data: sourceStripRows },
  ] = await Promise.all([
    supabase.from("email_accounts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("sender_rules").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    // Total new count (for stats bar)
    supabase.from("messages").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("state", "new").eq("archived", false),
    // New arrivals section (6 items)
    supabase.from("messages").select(MSG_SELECT)
      .eq("user_id", user.id).eq("state", "new").eq("archived", false)
      .order("received_at", { ascending: false }).limit(6),
    // Continue reading section (6 items)
    supabase.from("messages").select(MSG_SELECT)
      .eq("user_id", user.id).in("state", ["opened", "in_progress"]).eq("archived", false)
      .order("received_at", { ascending: false }).limit(6),
    // Recently read section (4 items)
    supabase.from("messages").select(MSG_SELECT)
      .eq("user_id", user.id).eq("state", "finished").eq("archived", false)
      .order("received_at", { ascending: false }).limit(4),
    // Saved for later section (6 items)
    supabase.from("messages").select(MSG_SELECT)
      .eq("user_id", user.id).eq("saved", true).eq("archived", false)
      .order("received_at", { ascending: false }).limit(6),
    // Source sample strip — one recent message per source (fetch recent 20, dedupe in-app)
    supabase.from("messages").select(MSG_SELECT)
      .eq("user_id", user.id).eq("archived", false)
      .order("received_at", { ascending: false }).limit(20),
  ]);

  const map = (rows: unknown[] | null) =>
    ((rows ?? []) as unknown as DbMessageRow[]).map(mapDbMessage);

  // Deduplicate source strip to one item per source
  const selectedSourceItems: MessageRecord[] = [];
  const seen = new Set<string>();
  for (const msg of map(sourceStripRows)) {
    if (seen.has(msg.sourceId)) continue;
    seen.add(msg.sourceId);
    selectedSourceItems.push(msg);
    if (selectedSourceItems.length === 4) break;
  }

  return {
    mode,
    newItems: map(newRows),
    newItemsTotal: newItemsTotal ?? 0,
    continueReading: map(continueRows),
    selectedSourceItems,
    savedItems: map(savedRows),
    recentlyRead: map(recentlyReadRows),
    isNewUser: (accountCount ?? 0) === 0 && (ruleCount ?? 0) === 0,
  } satisfies HomeData;
}

export async function getShellSummary() {
  const mode = await getRuntimeMode();
  if (mode === "setup") {
    return {
      status: "Your reading desk is almost ready.",
      sourceCount: 0,
      savedCount: 0,
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return {
      status: "Your reading desk is almost ready.",
      sourceCount: 0,
      savedCount: 0,
    };
  }

  const supabase = await createServerSupabaseClient();

  // Use lightweight aggregate queries instead of fetching all messages
  const [newCountResult, savedCountResult, sourceCountResult] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("state", "new")
      .eq("archived", false),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("saved", true)
      .eq("archived", false),
    supabase
      .from("newsletter_sources")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const newCount = newCountResult.count ?? 0;
  const savedCount = savedCountResult.count ?? 0;
  const sourceCount = sourceCountResult.count ?? 0;

  return {
    status:
      newCount > 0
        ? `${newCount} new issues waiting quietly`
        : "Caught up for now. New issues will appear here softly.",
    sourceCount,
    savedCount,
  };
}

const LIBRARY_PAGE_SIZE = 50;

export async function getLibraryData(
  filter: "all" | "new" | "reading" | "recently_read" | "saved" = "all",
  page = 1,
): Promise<LibraryData> {
  const mode = await getRuntimeMode();
  if (mode === "setup") return { mode, messages: [], totalCount: 0 };

  const user = await getCurrentUser();
  if (!user) return { mode, messages: [], totalCount: 0 };

  const supabase = await createServerSupabaseClient();
  const offset = (Math.max(1, page) - 1) * LIBRARY_PAGE_SIZE;

  let query = supabase
    .from("messages")
    .select(
      `
        id, source_id, subject, from_name, from_email, snippet,
        sent_at, received_at, unsubscribe_url,
        state, progress_percent, saved, archived, last_scroll_position,
        newsletter_sources(id, display_name, category, logo_url)
      `,
      { count: "exact" },
    )
    .eq("user_id", user.id);

  // Apply DB-side filter
  switch (filter) {
    case "new":
      query = query.eq("state", "new");
      break;
    case "reading":
      query = query.in("state", ["opened", "in_progress"]);
      break;
    case "recently_read":
      query = query.eq("state", "finished");
      break;
    case "saved":
      query = query.eq("saved", true);
      break;
  }

  const { data, error, count } = await query
    .order("received_at", { ascending: false })
    .range(offset, offset + LIBRARY_PAGE_SIZE - 1);

  if (error || !data) return { mode, messages: [], totalCount: 0 };

  return {
    mode,
    messages: (data as unknown as DbMessageRow[]).map(mapDbMessage),
    totalCount: count ?? 0,
  };
}

export async function getSourcesData(): Promise<SourcesData> {
  const mode = await getRuntimeMode();
  const sources = mode === "setup" ? [] : await getLiveSources();

  let pendingRules: SenderRule[] = [];
  if (mode === "live" && hasSupabaseConfig()) {
    const user = await getCurrentUser();
    if (user) {
      const supabase = await createServerSupabaseClient();
      const { data: rows } = await supabase
        .from("sender_rules")
        .select("id, rule_type, value, action, source_label, created_at")
        .eq("user_id", user.id)
        .eq("action", "include")
        .is("synced_at", null)
        .order("created_at", { ascending: false });

      if (rows) {
        pendingRules = rows.map((r) => ({
          id: r.id,
          ruleType: r.rule_type,
          value: r.value,
          action: r.action,
          sourceLabel: r.source_label ?? null,
          createdAt: r.created_at,
          active: true,
          messageCount: 0,
          sourceId: null,
        }));
      }
    }
  }

  return { mode, sources, pendingRules };
}

export async function getSourceData(sourceId: string): Promise<SourceDetailData | null> {
  const mode = await getRuntimeMode();
  if (mode === "setup") return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createServerSupabaseClient();

  const [sources, { data: msgRows, error: msgError }] = await Promise.all([
    getLiveSources(),
    supabase
      .from("messages")
      .select(
        `
          id, source_id, subject, from_name, from_email, snippet,
          sent_at, received_at, unsubscribe_url,
          state, progress_percent, saved, archived, last_scroll_position,
          newsletter_sources(id, display_name, category, logo_url)
        `,
      )
      .eq("user_id", user.id)
      .eq("source_id", sourceId)
      .order("received_at", { ascending: false }),
  ]);

  const source = sources.find((entry: SourceRecord) => entry.id === sourceId);
  if (!source) return null;

  const messages = msgError || !msgRows
    ? []
    : (msgRows as unknown as DbMessageRow[]).map(mapDbMessage);

  return { mode, source, messages };
}

export async function getSavedData(): Promise<LibraryData> {
  const mode = await getRuntimeMode();
  if (mode === "setup") return { mode, messages: [], totalCount: 0 };

  const user = await getCurrentUser();
  if (!user) return { mode, messages: [], totalCount: 0 };

  const supabase = await createServerSupabaseClient();
  const { data, error, count } = await supabase
    .from("messages")
    .select(
      `
        id, source_id, subject, from_name, from_email, snippet,
        sent_at, received_at, unsubscribe_url,
        state, progress_percent, saved, archived, last_scroll_position,
        newsletter_sources(id, display_name, category, logo_url)
      `,
      { count: "exact" },
    )
    .eq("user_id", user.id)
    .eq("saved", true)
    .order("received_at", { ascending: false });

  if (error || !data) return { mode, messages: [], totalCount: 0 };

  return {
    mode,
    messages: (data as unknown as DbMessageRow[]).map(mapDbMessage),
    totalCount: count ?? 0,
  };
}

export async function searchMessages(query: string): Promise<LibraryData> {
  const mode = await getRuntimeMode();
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return { mode, messages: [] };
  }

  if (mode === "setup") {
    return { mode, messages: [] };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { mode, messages: [] };
  }

  const supabase = await createServerSupabaseClient();

  const { data: messagesData, error } = await supabase
    .rpc("search_messages", { p_user_id: user.id, p_query: normalized });

  if (error || !messagesData) {
    return { mode, messages: [] };
  }

  // RPC returns flat rows — reshape to match DbMessageRow structure
  const rows = (messagesData as Array<{
    id: string; source_id: string; subject: string; from_name: string; from_email: string;
    snippet: string; sent_at: string; received_at: string; unsubscribe_url: string | null;
    state: string; progress_percent: number; saved: boolean; archived: boolean;
    last_scroll_position: number | null; display_name: string | null;
    category: string | null; logo_url: string | null;
  }>).map((r) => ({
    ...r,
    newsletter_sources: {
      id: r.source_id,
      display_name: r.display_name,
      category: r.category,
      logo_url: r.logo_url,
    },
  }));

  return {
    mode,
    messages: (rows as unknown as DbMessageRow[]).map(mapDbMessage),
  };
}

export async function getMessageData(messageId: string) {
  const mode = await getRuntimeMode();
  if (mode === "setup") return null;
  return getLiveMessageById(messageId);
}

export async function getSettingsData(): Promise<SettingsData> {
  const mode = await getRuntimeMode();
  if (mode === "setup") {
    return {
      mode,
      gmailConnected: false,
      lastSyncAt: null,
      messageCount: 0,
      includeRuleCount: 0,
      retentionDays: appEnv.retentionDays,
      metadataRetentionDays: appEnv.metadataRetentionDays,
      senderRules: [],
      lastError: null,
      userEmail: null,
      gmailEmail: null,
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return {
      mode: "setup",
      gmailConnected: false,
      lastSyncAt: null,
      messageCount: 0,
      includeRuleCount: 0,
      retentionDays: appEnv.retentionDays,
      metadataRetentionDays: appEnv.metadataRetentionDays,
      senderRules: [],
      lastError: null,
      userEmail: null,
      gmailEmail: null,
    };
  }

  const supabase = await createServerSupabaseClient();
  const [{ data: accounts }, { count }, { data: rules }, { data: msgRows }] = await Promise.all([
    supabase
      .from("email_accounts")
      .select("last_synced_at, last_error, email_address", { count: "exact" })
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .limit(1),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    // Issue 8: select source_id FK directly — no string matching needed
    supabase
      .from("sender_rules")
      .select("id, rule_type, value, action, source_label, created_at, active, source_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("messages")
      .select("source_id")
      .eq("user_id", user.id),
  ]);

  // Build message count per source_id
  const msgCountMap = new Map<string, number>();
  for (const row of msgRows ?? []) {
    msgCountMap.set(row.source_id, (msgCountMap.get(row.source_id) ?? 0) + 1);
  }

  return {
    mode,
    gmailConnected: Boolean(accounts?.[0]),
    lastSyncAt: accounts?.[0]?.last_synced_at || null,
    messageCount: count || 0,
    includeRuleCount: (rules || []).filter((rule) => rule.action === "include").length,
    retentionDays: appEnv.retentionDays,
    metadataRetentionDays: appEnv.metadataRetentionDays,
    senderRules:
      rules?.map((rule) => {
        const sourceId = rule.source_id ?? null;
        return {
          id: rule.id,
          ruleType: rule.rule_type,
          value: rule.value,
          action: rule.action,
          sourceLabel: rule.source_label,
          createdAt: rule.created_at,
          active: rule.active ?? true,
          messageCount: sourceId ? (msgCountMap.get(sourceId) ?? 0) : 0,
          sourceId,
        };
      }) || [],
    lastError: accounts?.[0]?.last_error || null,
    userEmail: user.email ?? null,
    gmailEmail: accounts?.[0]?.email_address ?? null,
  };
}

export async function updateMessageState(
  messageId: string,
  payload: {
    state?: MessageState;
    progressPercent?: number;
    saved?: boolean;
    archived?: boolean;
    lastScrollPosition?: number;
  },
) {
  const mode = await getRuntimeMode();
  if (mode === "setup") {
    return { ok: false, error: "Connect Supabase to track reading progress." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Not authenticated." };
  }

  const supabase = await createServerSupabaseClient();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    last_read_at: now,
  };

  // Only include fields that were explicitly provided — never overwrite with defaults
  if (payload.state !== undefined) update.state = payload.state;
  if (payload.progressPercent !== undefined) update.progress_percent = payload.progressPercent;
  if (payload.saved !== undefined) update.saved = payload.saved;
  if (payload.archived !== undefined) update.archived = payload.archived;
  if (payload.lastScrollPosition !== undefined) update.last_scroll_position = payload.lastScrollPosition;

  // opened_at: set only on first open ('opened' state), never overwrite on subsequent scroll events
  if (payload.state === "opened") {
    update.opened_at = now;
  }

  // finished_at: set when finishing, never cleared — preserves history if user re-reads
  if (payload.state === "finished" || payload.progressPercent === 100) {
    update.finished_at = now;
  }

  const { error } = await supabase
    .from("messages")
    .update(update)
    .eq("id", messageId)
    .eq("user_id", user.id);

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteMessage(messageId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", messageId)
    .eq("user_id", user.id);

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function createSenderRule(input: {
  ruleType: "sender_email" | "sender_domain";
  value: string;
  action: "include" | "exclude";
  sourceLabel?: string | null;
}) {
  const mode = await getRuntimeMode();
  if (mode === "setup") {
    return { ok: false, error: "Connect Supabase to save sender rules." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Not authenticated." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("sender_rules").insert({
    user_id: user.id,
    rule_type: input.ruleType,
    value:
      input.ruleType === "sender_domain"
        ? normalizeDomain(input.value)
        : normalizeSenderEmail(input.value),
    action: input.action,
    source_label: input.sourceLabel || null,
  });

  return error ? { ok: false, error: error.message } : { ok: true, message: "Rule saved." };
}

export async function deleteUserData() {
  const mode = await getRuntimeMode();
  if (mode === "setup") {
    return { ok: false, error: "No data to delete — Supabase is not configured yet." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Not authenticated." };
  }

  // Issue 11: single atomic RPC call — all deletes run inside one Postgres transaction.
  // The function deletes rules, sources (which cascades to messages and bodies),
  // sync_jobs, and resets the Gmail account sync state.
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("delete_user_data", { p_user_id: user.id });

  return error
    ? { ok: false, error: error.message }
    : { ok: true, message: "Synced newsletter data deleted." };
}

export async function disconnectGmail() {
  const mode = await getRuntimeMode();
  if (mode === "setup") {
    return { ok: false, error: "Gmail is not connected — configure Supabase first." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Not authenticated." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("email_accounts")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", "gmail");

  return error ? { ok: false, error: error.message } : { ok: true, message: "Gmail disconnected." };
}

const SYNC_BATCH_SIZE = 10;

async function syncMessageBatch(
  userId: string,
  accountId: string,
  messages: ParsedGmailMessage[],
  syncJobId?: string | null,
) {
  for (let i = 0; i < messages.length; i += SYNC_BATCH_SIZE) {
    const batch = messages.slice(i, i + SYNC_BATCH_SIZE);
    await Promise.all(
      batch.map(async (message) => {
        const source = await upsertSource(userId, message);
        await upsertMessage(userId, accountId, source.id, message, syncJobId);
      }),
    );
  }
}

type UpsertSourceResult = {
  id: string;
};

async function upsertSource(userId: string, message: ParsedGmailMessage) {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error("Supabase service role is required for live sync.");

  const senderEmail = normalizeSenderEmail(message.fromEmail);
  const senderDomain = normalizeDomain(message.senderDomain);

  // Check if source already exists to preserve first_seen_at
  const { data: existing } = await admin
    .from("newsletter_sources")
    .select("id, logo_url")
    .eq("user_id", userId)
    .eq("normalized_sender_email", senderEmail)
    .maybeSingle();

  if (existing) {
    // Update mutable fields; preserve first_seen_at and logo_url
    await admin
      .from("newsletter_sources")
      .update({
        display_name: message.fromName,
        last_seen_at: message.receivedAt,
        priority_level: message.priorityHint,
        // Only overwrite logo_url if the source doesn't already have one stored
        ...(!existing.logo_url && message.logoUrl ? { logo_url: message.logoUrl } : {}),
      })
      .eq("id", existing.id);

    // Issue 8: ensure the sender_rule FK points to this source (may be null if rule was created after first sync)
    await admin
      .from("sender_rules")
      .update({ source_id: existing.id })
      .eq("user_id", userId)
      .or(`value.eq.${senderEmail},value.eq.${senderDomain}`)
      .is("source_id", null);

    return existing as UpsertSourceResult;
  }

  const { data, error } = await admin
    .from("newsletter_sources")
    .insert({
      user_id: userId,
      normalized_sender_email: senderEmail,
      normalized_sender_domain: senderDomain,
      display_name: message.fromName,
      include_rule: message.detectionMethod === "manual_include",
      exclude_rule: false,
      priority_level: message.priorityHint,
      first_seen_at: message.receivedAt,
      last_seen_at: message.receivedAt,
      logo_url: message.logoUrl ?? null,
    })
    .select("id")
    .single();

  // 23505 = unique_violation: a concurrent batch worker inserted the same source
  // a moment before us. Fetch the row it created and continue normally.
  if (error?.code === "23505") {
    const { data: raced } = await admin
      .from("newsletter_sources")
      .select("id")
      .eq("user_id", userId)
      .eq("normalized_sender_email", senderEmail)
      .single();
    if (raced) return raced as UpsertSourceResult;
  }

  if (error || !data) {
    throw new Error(error?.message || "Unable to insert source.");
  }

  // Issue 8: link the matching sender_rule to the newly created source
  await admin
    .from("sender_rules")
    .update({ source_id: data.id })
    .eq("user_id", userId)
    .or(`value.eq.${senderEmail},value.eq.${senderDomain}`)
    .is("source_id", null);

  return data as UpsertSourceResult;
}

async function upsertMessage(userId: string, accountId: string, sourceId: string, message: ParsedGmailMessage, syncJobId?: string | null) {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error("Supabase service role is required for live sync.");

  const { data, error } = await admin
    .from("messages")
    .upsert(
      {
        user_id: userId,
        email_account_id: accountId,
        source_id: sourceId,
        provider_message_id: message.providerMessageId,
        provider_thread_id: message.providerThreadId,
        internet_message_id: message.internetMessageId,
        subject: message.subject,
        from_name: message.fromName,
        from_email: message.fromEmail,
        sent_at: message.sentAt,
        received_at: message.receivedAt,
        snippet: message.snippet,
        unsubscribe_url: message.unsubscribeUrl,
        raw_headers_json: message.rawHeadersJson,
        detection_method: message.detectionMethod,
        ...(syncJobId ? { sync_job_id: syncJobId } : {}),
      },
      {
        onConflict: "user_id,provider_message_id",
      },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Unable to upsert message.");
  }

  await admin.from("message_bodies").upsert(
    {
      message_id: data.id,
      user_id: userId,
      html_content: message.sanitizedHtmlContent,
      text_content: message.textContent,
      raw_html_content: message.rawHtmlContent ?? null,
      sanitized_html_content: message.sanitizedHtmlContent,
      extracted_readable_text: message.extractedReadableText,
    },
    {
      onConflict: "message_id",
    },
  );

  // State defaults (new, 0 progress, etc.) are set by column defaults on insert;
  // on conflict (re-sync) we intentionally preserve the existing reading state.
}

async function pruneOldBodies(userId: string) {
  if (appEnv.disableRetention) return;

  const admin = createAdminSupabaseClient();
  if (!admin) return;

  // Pass 1: Null out all body content for messages older than retentionDays (45 days).
  const bodyCutoff = new Date();
  bodyCutoff.setDate(bodyCutoff.getDate() - appEnv.retentionDays);

  const { data: oldMessages } = await admin
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("saved", false)
    .eq("archived", false)
    .lt("received_at", bodyCutoff.toISOString());

  const bodyIds = oldMessages?.map((row) => row.id) || [];
  if (bodyIds.length) {
    await admin
      .from("message_bodies")
      .update({
        html_content: null,
        raw_html_content: null,
        sanitized_html_content: null,
        text_content: null,
        extracted_readable_text: null,
        pruned_at: new Date().toISOString(),
      })
      .in("message_id", bodyIds);
  }

  // Pass 2: Delete messages entirely after metadataRetentionDays (90 days).
  const metaCutoff = new Date();
  metaCutoff.setDate(metaCutoff.getDate() - appEnv.metadataRetentionDays);

  await admin
    .from("messages")
    .delete()
    .eq("user_id", userId)
    .eq("saved", false)
    .eq("archived", false)
    .lt("received_at", metaCutoff.toISOString());
}

export async function startGmailConnection() {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in first to connect Gmail." };
  }

  if (!hasGmailConfig()) {
    return {
      ok: false,
      error:
        "Missing Gmail env vars. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REDIRECT_URI, and APP_ENCRYPTION_KEY.",
    };
  }

  const state = `${user.id}:${Date.now()}`;
  const { createGmailConnectUrl } = await import("@/lib/gmail");

  return { ok: true, url: createGmailConnectUrl(state), state };
}

export async function completeGmailConnection(code: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("User not authenticated.");
  }

  const { exchangeGmailCode } = await import("@/lib/gmail");
  const result = await exchangeGmailCode(code);
  const admin = createAdminSupabaseClient();

  if (!admin) {
    throw new Error("Supabase service role key is required to persist Gmail connections.");
  }

  const { data, error } = await admin
    .from("email_accounts")
    .upsert(
      {
        user_id: user.id,
        provider: "gmail",
        provider_account_id: result.emailAddress,
        access_token_encrypted: encryptSecret(result.tokens.access_token || ""),
        refresh_token_encrypted: result.tokens.refresh_token
          ? encryptSecret(result.tokens.refresh_token)
          : null,
        token_expires_at: result.tokens.expiry_date
          ? new Date(result.tokens.expiry_date).toISOString()
          : null,
        email_address: result.emailAddress,
        sync_enabled: true,
        history_id: result.historyId,
        last_synced_at: null,
        last_error: null,
      },
      {
        onConflict: "user_id,provider",
      },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to connect Gmail.");
  }

  return { accountId: data.id };
}

export type SyncProgressCallback = (progress: number, message: string) => void;

export async function runSync(onProgress?: SyncProgressCallback) {
  const mode = await getRuntimeMode();
  if (mode === "setup") {
    return {
      ok: false,
      error:
        "Configure Supabase and Gmail environment variables to enable live sync.",
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Not authenticated." };
  }

  if (!hasGmailConfig() || !hasAdminSupabaseConfig()) {
    return {
      ok: false,
      error:
        "Live sync requires Gmail credentials, APP_ENCRYPTION_KEY, and SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const admin = createAdminSupabaseClient();
  if (!admin) {
    return { ok: false, error: "Supabase admin client unavailable." };
  }

  onProgress?.(5, "Checking account…");

  const { data: account, error: accountError } = await admin
    .from("email_accounts")
    .select(
      "id, access_token_encrypted, refresh_token_encrypted, email_address, history_id, last_synced_at",
    )
    .eq("user_id", user.id)
    .eq("provider", "gmail")
    .single();

  if (accountError || !account) {
    return { ok: false, error: "Connect Gmail before running sync." };
  }

  onProgress?.(10, "Loading sender rules…");

  const { data: rules } = await admin
    .from("sender_rules")
    .select("id, rule_type, value, action, synced_at, active")
    .eq("user_id", user.id)
    .eq("active", true);

  const syncRules = rules || [];
  const includeRules = syncRules.filter((rule) => rule.action === "include");
  if (!includeRules.length) {
    return {
      ok: false,
      error:
        "Add at least one included sender email or domain before syncing. V1 only syncs newsletters from explicitly tracked rules.",
    };
  }

  const syncJob = await admin
    .from("sync_jobs")
    .insert({
      user_id: user.id,
      email_account_id: account.id,
      sync_type: "manual",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  try {
    const { syncNewslettersFromGmail } = await import("@/lib/gmail");
    const accessToken = decryptSecret(account.access_token_encrypted);
    const refreshToken = account.refresh_token_encrypted
      ? decryptSecret(account.refresh_token_encrypted)
      : null;
    const allMappedRules = syncRules.map((rule) => ({
      ruleType: rule.rule_type,
      value: rule.value,
      action: rule.action,
    }));

    onProgress?.(20, "Starting sync…");

    // New include rules (synced_at = null) need a targeted full-query backfill
    // so their historical emails are pulled without re-querying every other sender.
    const newIncludeRules = includeRules.filter((rule) => !rule.synced_at);
    let backfillSkipped = 0;
    let backfillProcessed = 0;
    if (newIncludeRules.length > 0) {
      onProgress?.(30, `Backfilling ${newIncludeRules.length} new sender${newIncludeRules.length === 1 ? "" : "s"}…`);
      const backfillResult = await syncNewslettersFromGmail({
        accessToken,
        refreshToken,
        historyId: null, // always full lookback for backfill
        rules: allMappedRules,
        queryRules: newIncludeRules.map((rule) => ({
          ruleType: rule.rule_type,
          value: rule.value,
          action: rule.action,
        })),
      });

      onProgress?.(45, `Saving backfill (${backfillResult.messages.length} messages)…`);
      await syncMessageBatch(user.id, account.id, backfillResult.messages, syncJob.data?.id);

      backfillSkipped += backfillResult.skippedCount;
      backfillProcessed += backfillResult.messages.length;

      // Mark these rules as synced so future runs use incremental sync
      await admin
        .from("sender_rules")
        .update({ synced_at: new Date().toISOString() })
        .in("id", newIncludeRules.map((r) => r.id));
    }

    onProgress?.(55, "Fetching recent emails…");

    // Only use incremental sync (historyId) after the first full sync has run.
    // On first sync last_synced_at is null — always do a full query so historical
    // emails from the last SYNC_LOOKBACK_DAYS window are pulled in.
    const isFirstSync = !account.last_synced_at;
    const historyIdForSync = isFirstSync ? null : account.history_id;

    const result = await syncNewslettersFromGmail({
      accessToken,
      refreshToken,
      historyId: historyIdForSync,
      rules: allMappedRules,
      // Cap first-ever sync to retentionDays so every message has body content.
      // Subsequent syncs use the full syncLookbackDays window.
      lookbackDays: isFirstSync ? appEnv.retentionDays : undefined,
    });

    onProgress?.(75, `Saving ${result.messages.length} message${result.messages.length === 1 ? "" : "s"}…`);
    await syncMessageBatch(user.id, account.id, result.messages, syncJob.data?.id);

    onProgress?.(90, "Cleaning up…");
    await pruneOldBodies(user.id);

    // Persist refreshed OAuth tokens so they survive across syncs
    const accountUpdate: Record<string, unknown> = {
      last_synced_at: new Date().toISOString(),
      history_id: result.historyId,
      last_error: null,
    };

    if (result.refreshedTokens) {
      accountUpdate.access_token_encrypted = encryptSecret(
        result.refreshedTokens.accessToken,
      );
      if (result.refreshedTokens.refreshToken) {
        accountUpdate.refresh_token_encrypted = encryptSecret(
          result.refreshedTokens.refreshToken,
        );
      }
      if (result.refreshedTokens.expiryDate) {
        accountUpdate.token_expires_at = new Date(
          result.refreshedTokens.expiryDate,
        ).toISOString();
      }
    }

    await admin
      .from("email_accounts")
      .update(accountUpdate)
      .eq("id", account.id);

    const totalProcessed = result.messages.length + backfillProcessed;
    const totalSkipped = result.skippedCount + backfillSkipped;

    await admin
      .from("sync_jobs")
      .update({
        status: "done",
        finished_at: new Date().toISOString(),
        messages_processed: totalProcessed,
        messages_inserted: totalProcessed,
        messages_skipped: totalSkipped,
        sync_mode: historyIdForSync ? "incremental" : "full",
      })
      .eq("id", syncJob.data?.id);
    const skippedNote = totalSkipped > 0
      ? ` ${totalSkipped} messages were skipped due to errors.`
      : "";

    onProgress?.(100, "Done");
    return {
      ok: true,
      message: `Tracked-source sync completed. ${result.messages.length} newsletter issues were processed from ${includeRules.length} included sender rules.${skippedNote}`,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Unexpected sync failure.";
    // Translate known OAuth and Postgres errors into user-friendly messages
    const message = /invalid_grant/i.test(raw)
      ? "Gmail connection expired. Please disconnect and reconnect Gmail to continue syncing."
      : /violates|constraint|duplicate|syntax|column|relation/i.test(raw)
      ? "Sync encountered a data conflict. Please try again."
      : raw;

    if (syncJob.data?.id) {
      await admin
        .from("sync_jobs")
        .update({
          status: "failed",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", syncJob.data.id);
    }

    await admin
      .from("email_accounts")
      .update({
        last_error: message,
      })
      .eq("id", account.id);

    return { ok: false, error: message };
  }
}

export async function runSyncForRule(ruleId: string, mode: "catchup" | "fresh") {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  if (!hasGmailConfig() || !hasAdminSupabaseConfig()) {
    return { ok: false, error: "Live sync requires Gmail credentials and Supabase service role key." };
  }

  const admin = createAdminSupabaseClient();
  if (!admin) return { ok: false, error: "Supabase admin client unavailable." };

  const { data: rule } = await admin
    .from("sender_rules")
    .select("id, rule_type, value, action")
    .eq("id", ruleId)
    .eq("user_id", user.id)
    .single();

  if (!rule) return { ok: false, error: "Rule not found." };

  // Set synced_at based on chosen mode
  await admin
    .from("sender_rules")
    .update({ synced_at: mode === "fresh" ? new Date().toISOString() : null, active: true })
    .eq("id", ruleId)
    .eq("user_id", user.id);

  // For "fresh" mode — no backfill needed, future sync will pick up new emails
  if (mode === "fresh") {
    return { ok: true, message: "Rule activated. New newsletters from this sender will appear on your next sync." };
  }

  // For "catchup" mode — run a targeted backfill for this sender
  const { data: account } = await admin
    .from("email_accounts")
    .select("id, access_token_encrypted, refresh_token_encrypted")
    .eq("user_id", user.id)
    .eq("provider", "gmail")
    .single();

  if (!account) return { ok: false, error: "Connect Gmail before syncing." };

  const { data: allRules } = await admin
    .from("sender_rules")
    .select("rule_type, value, action")
    .eq("user_id", user.id)
    .eq("active", true);

  try {
    const { syncNewslettersFromGmail } = await import("@/lib/gmail");
    const accessToken = decryptSecret(account.access_token_encrypted);
    const refreshToken = account.refresh_token_encrypted ? decryptSecret(account.refresh_token_encrypted) : null;

    const result = await syncNewslettersFromGmail({
      accessToken,
      refreshToken,
      historyId: null, // full lookback for catch-up
      rules: (allRules || []).map((r) => ({ ruleType: r.rule_type, value: r.value, action: r.action })),
      queryRules: [{ ruleType: rule.rule_type, value: rule.value, action: rule.action }],
    });

    await syncMessageBatch(user.id, account.id, result.messages);

    await admin
      .from("sender_rules")
      .update({ synced_at: new Date().toISOString() })
      .eq("id", ruleId);

    return { ok: true, message: `Catch-up complete. ${result.messages.length} newsletters synced from this sender.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    return { ok: false, error: message };
  }
}

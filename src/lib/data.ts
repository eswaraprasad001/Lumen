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
  user_message_states?: Array<{
    state: MessageState;
    progress_percent: number | null;
    saved: boolean | null;
    archived: boolean | null;
    last_scroll_position: number | null;
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
  // Supabase may return the joined relation as an array or a single object
  const stateRaw = row.user_message_states;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = Array.isArray(stateRaw) ? stateRaw[0] : (stateRaw as any);
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
    state: state?.state || "new",
    progressPercent: state?.progress_percent || 0,
    saved: Boolean(state?.saved),
    archived: Boolean(state?.archived),
    sanitizedHtmlContent: body?.sanitized_html_content,
    textContent: body?.text_content,
    extractedReadableText: body?.extracted_readable_text,
    unsubscribeUrl: row.unsubscribe_url,
    estimatedReadMinutes: estimateReadMinutes(
      body?.extracted_readable_text || body?.text_content || row.snippet || "",
    ),
    lastScrollPosition: state?.last_scroll_position || 0,
    logoUrl: row.newsletter_sources?.logo_url ?? null,
    bodyExpired:
      !body?.sanitized_html_content &&
      !body?.text_content &&
      !body?.extracted_readable_text &&
      (Date.now() - new Date(row.received_at).getTime()) / 86400000 > appEnv.retentionDays,
  };
}

// buildHomeData kept for potential future reuse; not currently used after home-specific queries.

function buildSources(messages: MessageRecord[], sources: SourceRecord[]) {
  return sources.map((source) => {
    const related = messages.filter((message) => message.sourceId === source.id);
    return {
      ...source,
      messageCount: related.length,
      lastReceivedAt:
        related.sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt))[0]?.receivedAt ||
        source.lastReceivedAt,
    };
  });
}

const getLiveMessages = cache(async function getLiveMessages(): Promise<MessageRecord[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createServerSupabaseClient();

  // Fetch messages and their user-specific states in separate queries to avoid
  // embedded-join RLS issues where user_message_states rows may not be returned.
  const [messagesResult, statesResult] = await Promise.all([
    supabase
      .from("messages")
      .select(
        `
          id,
          source_id,
          subject,
          from_name,
          from_email,
          snippet,
          sent_at,
          received_at,
          unsubscribe_url,
          newsletter_sources(id, display_name, category, logo_url)
        `,
      )
      .eq("user_id", user.id)
      .order("received_at", { ascending: false })
      .limit(200),
    supabase
      .from("user_message_states")
      .select("message_id, state, progress_percent, saved, archived, last_scroll_position")
      .eq("user_id", user.id),
  ]);

  if (messagesResult.error || !messagesResult.data) {
    return [];
  }

  // Build a fast lookup map from message_id → state row
  const stateMap = new Map<string, {
    state: MessageState;
    progress_percent: number | null;
    saved: boolean | null;
    archived: boolean | null;
    last_scroll_position: number | null;
  }>();
  for (const row of statesResult.data ?? []) {
    stateMap.set(row.message_id, row as {
      state: MessageState;
      progress_percent: number | null;
      saved: boolean | null;
      archived: boolean | null;
      last_scroll_position: number | null;
    });
  }

  return (messagesResult.data as unknown as DbMessageRow[]).map((row) => {
    const stateRow = stateMap.get(row.id) ?? null;
    // Inject the state row into the row so mapDbMessage can read it
    return mapDbMessage({ ...row, user_message_states: stateRow ? [stateRow] : [] });
  });
});

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
        id,
        source_id,
        subject,
        from_name,
        from_email,
        snippet,
        sent_at,
        received_at,
        unsubscribe_url,
        newsletter_sources(id, display_name, category, logo_url),
        message_bodies(sanitized_html_content, text_content, extracted_readable_text),
        user_message_states(state, progress_percent, saved, archived, last_scroll_position)
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
      html_content: parsed.sanitizedHtmlContent,
      text_content: parsed.textContent,
      sanitized_html_content: parsed.sanitizedHtmlContent,
      extracted_readable_text: parsed.extractedReadableText,
    },
    { onConflict: "message_id" },
  );

  return { ok: true };
}

const getLiveSources = cache(async function getLiveSources(messages: MessageRecord[]): Promise<SourceRecord[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("newsletter_sources")
    .select(
      "id, display_name, normalized_sender_email, normalized_sender_domain, description, category, include_rule, exclude_rule, priority_level, last_seen_at",
    )
    .eq("user_id", user.id)
    .order("last_seen_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  const { data: rules } = await supabase
    .from("sender_rules")
    .select("id, value, source_label, active")
    .eq("user_id", user.id);

  const ruleMap = new Map((rules ?? []).map((r) => [r.value.toLowerCase(), { id: r.id, label: r.source_label, active: r.active as boolean }]));

  const sources = data.map((row) => {
    const matchedRule =
      ruleMap.get((row.normalized_sender_email ?? "").toLowerCase()) ??
      ruleMap.get((row.normalized_sender_domain ?? "").toLowerCase()) ??
      null;
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
      messageCount: 0,
      lastReceivedAt: row.last_seen_at,
      ruleId: matchedRule?.id ?? null,
      ruleLabel: matchedRule?.label ?? null,
      ruleActive: matchedRule?.active ?? null,
    };
  }) satisfies SourceRecord[];

  return buildSources(messages, sources);
});

export async function getHomeData() {
  const [mode, messages] = await Promise.all([getRuntimeMode(), getLiveMessages()]);

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

  // Detect first-time users: no Gmail account connected and no sender rules yet
  const user = await getCurrentUser();
  let isNewUser = false;
  if (user) {
    const supabase = await createServerSupabaseClient();
    const [{ count: accountCount }, { count: ruleCount }] = await Promise.all([
      supabase.from("email_accounts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("sender_rules").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);
    isNewUser = accountCount === 0 && ruleCount === 0;
  }

  const active = messages.filter((m: MessageRecord) => !m.archived);

  // New arrivals: never opened (state is still "new"), most recent first
  const allNewItems = active.filter((m: MessageRecord) => m.state === "new");
  const newItems = allNewItems.slice(0, 6);

  // Continue reading: opened or actively in progress (not yet finished or saved)
  const continueReading = active
    .filter((m: MessageRecord) => m.state === "in_progress" || m.state === "opened")
    .slice(0, 6);

  // Recently read: fully finished articles
  const recentlyRead = active
    .filter((m: MessageRecord) => m.state === "finished")
    .slice(0, 4);

  // Saved for later
  const savedItems = active
    .filter((m: MessageRecord) => m.saved || m.state === "saved")
    .slice(0, 6);

  // One article per source for the source sample strip
  const selectedSourceItems: MessageRecord[] = [];
  const seen = new Set<string>();
  for (const message of active) {
    if (seen.has(message.sourceId)) continue;
    seen.add(message.sourceId);
    selectedSourceItems.push(message);
    if (selectedSourceItems.length === 4) break;
  }

  return {
    mode,
    newItems,
    newItemsTotal: allNewItems.length,
    continueReading,
    selectedSourceItems,
    savedItems,
    recentlyRead,
    isNewUser,
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
      .from("user_message_states")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("state", "new")
      .eq("archived", false),
    supabase
      .from("user_message_states")
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

export async function getLibraryData(): Promise<LibraryData> {
  const [mode, messages] = await Promise.all([getRuntimeMode(), getLiveMessages()]);
  return {
    mode,
    messages,
  };
}

export async function getSourcesData(): Promise<SourcesData> {
  const [mode, messages] = await Promise.all([getRuntimeMode(), getLiveMessages()]);
  const sources = mode === "setup" ? [] : await getLiveSources(messages);

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
  const [mode, messages] = await Promise.all([getRuntimeMode(), getLiveMessages()]);
  if (mode === "setup") return null;
  const sources = await getLiveSources(messages);
  const source = sources.find((entry: SourceRecord) => entry.id === sourceId);

  if (!source) return null;

  return {
    mode,
    source,
    messages: messages.filter((message: MessageRecord) => message.sourceId === sourceId),
  };
}

export async function getSavedData(): Promise<LibraryData> {
  const [mode, messages] = await Promise.all([getRuntimeMode(), getLiveMessages()]);
  return {
    mode,
    messages: messages.filter((message: MessageRecord) => message.saved || message.state === "saved"),
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

  // Fetch messages (without bodies — list views don't need them) and states separately
  // to work around embedded-join RLS issues, consistent with getLiveMessages().
  const [messagesResult, statesResult] = await Promise.all([
    supabase
      .from("messages")
      .select(
        `
          id,
          source_id,
          subject,
          from_name,
          from_email,
          snippet,
          sent_at,
          received_at,
          unsubscribe_url,
          newsletter_sources(id, display_name, category, logo_url)
        `,
      )
      .eq("user_id", user.id)
      .or(
        [
          `subject.ilike.%${normalized}%`,
          `from_email.ilike.%${normalized}%`,
          `from_name.ilike.%${normalized}%`,
          `snippet.ilike.%${normalized}%`,
        ].join(","),
      )
      .order("received_at", { ascending: false })
      .limit(50),
    supabase
      .from("user_message_states")
      .select("message_id, state, progress_percent, saved, archived, last_scroll_position")
      .eq("user_id", user.id),
  ]);

  if (messagesResult.error || !messagesResult.data) {
    return { mode, messages: [] };
  }

  const stateMap = new Map<string, {
    state: MessageState;
    progress_percent: number | null;
    saved: boolean | null;
    archived: boolean | null;
    last_scroll_position: number | null;
  }>();
  for (const row of statesResult.data ?? []) {
    stateMap.set(row.message_id, row as {
      state: MessageState;
      progress_percent: number | null;
      saved: boolean | null;
      archived: boolean | null;
      last_scroll_position: number | null;
    });
  }

  return {
    mode,
    messages: (messagesResult.data as unknown as DbMessageRow[]).map((row) => {
      const stateRow = stateMap.get(row.id) ?? null;
      return mapDbMessage({ ...row, user_message_states: stateRow ? [stateRow] : [] });
    }),
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
  const [{ data: accounts }, { count }, { data: rules }, { data: sources }, { data: msgRows }] = await Promise.all([
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
    supabase
      .from("sender_rules")
      .select("id, rule_type, value, action, source_label, created_at, active")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("newsletter_sources")
      .select("id, normalized_sender_email, normalized_sender_domain")
      .eq("user_id", user.id),
    supabase
      .from("messages")
      .select("source_id")
      .eq("user_id", user.id),
  ]);

  // Build source lookup: email/domain → { id }
  const sourceByEmail = new Map((sources ?? []).map((s) => [s.normalized_sender_email?.toLowerCase(), s.id]));
  const sourceByDomain = new Map((sources ?? []).map((s) => [s.normalized_sender_domain?.toLowerCase(), s.id]));

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
        const val = rule.value.toLowerCase();
        const sourceId =
          (rule.rule_type === "sender_email" ? sourceByEmail.get(val) : sourceByDomain.get(val)) ?? null;
        return {
          id: rule.id,
          ruleType: rule.rule_type,
          value: rule.value,
          action: rule.action,
          sourceLabel: rule.source_label,
          createdAt: rule.created_at,
          active: rule.active ?? true,
          messageCount: sourceId ? (msgCountMap.get(sourceId) ?? 0) : 0,
          sourceId: sourceId ?? null,
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
  const update: Record<string, unknown> = {
    user_id: user.id,
    message_id: messageId,
    state: payload.state || "opened",
    progress_percent: payload.progressPercent ?? 0,
    saved: payload.saved ?? payload.state === "saved",
    archived: payload.archived ?? payload.state === "archived",
    last_scroll_position: payload.lastScrollPosition ?? 0,
    last_read_at: new Date().toISOString(),
    finished_at:
      payload.state === "finished" || payload.progressPercent === 100
        ? new Date().toISOString()
        : null,
  };

  // Only set opened_at on the first open — don't overwrite on repeated updates
  if (payload.state === "opened" || payload.state === "in_progress") {
    // Let the upsert insert it for new rows; for existing rows, preserve the original timestamp
    update.opened_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("user_message_states")
    .upsert(update, { onConflict: "user_id,message_id" });

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

  const supabase = await createServerSupabaseClient();

  await supabase.from("message_bodies").delete().in(
    "message_id",
    (
      await supabase.from("messages").select("id").eq("user_id", user.id)
    ).data?.map((row) => row.id) || [],
  );

  await supabase.from("user_message_states").delete().eq("user_id", user.id);
  await supabase.from("messages").delete().eq("user_id", user.id);
  await supabase.from("newsletter_sources").delete().eq("user_id", user.id);
  await supabase.from("sender_rules").delete().eq("user_id", user.id);
  await supabase.from("sync_jobs").delete().eq("user_id", user.id);

  // Reset sync state so the next sync does a full lookback query
  const admin = createAdminSupabaseClient();
  if (admin) {
    await admin
      .from("email_accounts")
      .update({ last_synced_at: null, history_id: null, last_error: null })
      .eq("user_id", user.id)
      .eq("provider", "gmail");
  }

  return { ok: true, message: "Synced newsletter data deleted." };
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
) {
  for (let i = 0; i < messages.length; i += SYNC_BATCH_SIZE) {
    const batch = messages.slice(i, i + SYNC_BATCH_SIZE);
    await Promise.all(
      batch.map(async (message) => {
        const source = await upsertSource(userId, message);
        await upsertMessage(userId, accountId, source.id, message);
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

  return data as UpsertSourceResult;
}

async function upsertMessage(userId: string, accountId: string, sourceId: string, message: ParsedGmailMessage) {
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
      },
      {
        onConflict: "provider_message_id",
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
      html_content: message.sanitizedHtmlContent,
      text_content: message.textContent,
      sanitized_html_content: message.sanitizedHtmlContent,
      extracted_readable_text: message.extractedReadableText,
    },
    {
      onConflict: "message_id",
    },
  );

  // Only create state for genuinely new messages — preserve existing reading states
  await admin.from("user_message_states").upsert(
    {
      user_id: userId,
      message_id: data.id,
      state: "new",
      progress_percent: 0,
      saved: false,
      archived: false,
      last_scroll_position: 0,
    },
    {
      onConflict: "user_id,message_id",
      ignoreDuplicates: true,
    },
  );
}

async function pruneOldBodies(userId: string) {
  const admin = createAdminSupabaseClient();
  if (!admin) return;

  // Pass 1: Null out all body content for messages older than retentionDays (45 days).
  const bodyCutoff = new Date();
  bodyCutoff.setDate(bodyCutoff.getDate() - appEnv.retentionDays);

  const { data: oldMessages } = await admin
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .lt("received_at", bodyCutoff.toISOString());

  const bodyIds = oldMessages?.map((row) => row.id) || [];
  if (bodyIds.length) {
    await admin
      .from("message_bodies")
      .update({
        html_content: null,
        sanitized_html_content: null,
        text_content: null,
        extracted_readable_text: null,
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
    let backfillSkipped = 0; // accumulates skipped counts from backfill pass
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
      await syncMessageBatch(user.id, account.id, backfillResult.messages);

      backfillSkipped += backfillResult.skippedCount;

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
    const historyIdForSync = account.last_synced_at ? account.history_id : null;

    const result = await syncNewslettersFromGmail({
      accessToken,
      refreshToken,
      historyId: historyIdForSync,
      rules: allMappedRules,
    });

    onProgress?.(75, `Saving ${result.messages.length} message${result.messages.length === 1 ? "" : "s"}…`);
    await syncMessageBatch(user.id, account.id, result.messages);

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

    await admin
      .from("sync_jobs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
      })
      .eq("id", syncJob.data?.id);

    const totalSkipped = result.skippedCount + backfillSkipped;
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

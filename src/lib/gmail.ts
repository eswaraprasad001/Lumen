import { gmail_v1, google } from "googleapis";

import {
  detectNewsletter,
  decodeBase64Url,
  extractHeaders,
  extractPublisherLogoUrl,
  flattenMimeParts,
  htmlToText,
  normalizeContentId,
  parseAddressHeader,
  replaceCidUrls,
  sanitizeNewsletterHtml,
} from "@/lib/content";
import { appEnv } from "@/lib/env";
import { estimateReadMinutes } from "@/lib/utils";

type SyncRule = {
  ruleType: string;
  value: string;
  action: "include" | "exclude";
};

function buildRuleScopedQuery(rules: SyncRule[]) {
  const includeRules = rules.filter((rule) => rule.action === "include");
  if (!includeRules.length) {
    return null;
  }

  const senderQueries = includeRules.map((rule) =>
    rule.ruleType === "sender_email"
      ? `from:${rule.value}`
      : `from:${rule.value}`,
  );

  return `newer_than:${appEnv.syncLookbackDays}d {${senderQueries.join(" ")}}`;
}

export type ParsedGmailMessage = {
  providerMessageId: string;
  internetMessageId: string;
  providerThreadId: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  senderDomain: string;
  receivedAt: string;
  sentAt: string;
  snippet: string;
  unsubscribeUrl: string | null;
  rawHeadersJson: Record<string, string>;
  textContent: string;
  sanitizedHtmlContent: string | null;
  extractedReadableText: string;
  detectionMethod: string;
  priorityHint: "core" | "normal";
  estimatedReadMinutes: number | null;
  logoUrl: string | null;
};

function createOAuthClient() {
  return new google.auth.OAuth2(
    appEnv.googleClientId,
    appEnv.googleClientSecret,
    appEnv.gmailRedirectUri,
  );
}

export function createGmailConnectUrl(state: string) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    state,
  });
}

export async function exchangeGmailCode(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });

  return {
    tokens,
    emailAddress: profile.data.emailAddress || "",
    historyId: profile.data.historyId || null,
  };
}

function extractUnsubscribe(headers: Record<string, string>) {
  const header = headers["list-unsubscribe"];
  if (!header) return null;

  const match = header.match(/<([^>]+)>/);
  return match?.[1] || header.split(",")[0]?.trim() || null;
}

function toBase64(input: string) {
  return input.replace(/-/g, "+").replace(/_/g, "/");
}

async function getPartBodyData(
  gmail: gmail_v1.Gmail,
  messageId: string,
  part: {
    body?: {
      attachmentId?: string | null;
      data?: string | null;
    } | null;
  },
) {
  if (part.body?.data) {
    return part.body.data;
  }

  if (!part.body?.attachmentId) {
    return null;
  }

  const attachment = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: part.body.attachmentId,
  });

  return attachment.data.data || null;
}

async function extractRenderableContent(
  gmail: gmail_v1.Gmail,
  messageId: string,
  payload: gmail_v1.Schema$MessagePart | undefined,
) {
  const parts = flattenMimeParts(payload);
  const htmlCandidates: string[] = [];
  const textCandidates: string[] = [];
  const cidToDataUrl = new Map<string, string>();

  for (const part of parts) {
    const mimeType = (part.mimeType || "").toLowerCase();
    const bodyData = await getPartBodyData(gmail, messageId, part);
    const contentId = normalizeContentId(part.headers["content-id"]);

    if (!bodyData) {
      continue;
    }

    if (mimeType === "text/html") {
      htmlCandidates.push(decodeBase64Url(bodyData));
      continue;
    }

    if (mimeType === "text/plain") {
      textCandidates.push(decodeBase64Url(bodyData));
      continue;
    }

    if (contentId && mimeType.startsWith("image/")) {
      cidToDataUrl.set(contentId, `data:${mimeType};base64,${toBase64(bodyData)}`);
    }
  }

  const htmlContent = htmlCandidates.at(-1) || null;
  const textContent = textCandidates.at(-1) || null;
  const hydratedHtml = htmlContent ? replaceCidUrls(htmlContent, cidToDataUrl) : null;

  return {
    htmlContent: hydratedHtml,
    textContent: textContent || htmlToText(hydratedHtml),
  };
}

async function fetchMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
  rules: SyncRule[],
) {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = response.data.payload;
  const headers = extractHeaders(payload);
  const { fromName, fromEmail, senderDomain } = parseAddressHeader(headers.from);
  const detection = detectNewsletter(headers, fromEmail, senderDomain, rules);

  if (!detection.shouldInclude) {
    return null;
  }

  const { htmlContent, textContent } = await extractRenderableContent(
    gmail,
    messageId,
    payload,
  );
  const sanitizedHtmlContent = sanitizeNewsletterHtml(htmlContent, senderDomain);
  const extractedReadableText = textContent || htmlToText(sanitizedHtmlContent);
  const logoUrl = htmlContent ? extractPublisherLogoUrl(htmlContent, senderDomain) : null;

  return {
    providerMessageId: response.data.id || messageId,
    internetMessageId: headers["message-id"] || messageId,
    providerThreadId: response.data.threadId || messageId,
    subject: headers.subject || "(No subject)",
    fromName,
    fromEmail,
    senderDomain,
    receivedAt: headers.date
      ? new Date(headers.date).toISOString()
      : new Date().toISOString(),
    sentAt: headers.date
      ? new Date(headers.date).toISOString()
      : new Date().toISOString(),
    snippet: response.data.snippet || textContent.slice(0, 180),
    unsubscribeUrl: extractUnsubscribe(headers),
    rawHeadersJson: headers,
    textContent,
    sanitizedHtmlContent,
    extractedReadableText,
    detectionMethod: detection.detectionMethod,
    priorityHint: detection.detectionMethod.startsWith("manual") ? "core" : "normal",
    estimatedReadMinutes: estimateReadMinutes(extractedReadableText),
    logoUrl,
  } satisfies ParsedGmailMessage;
}

/**
 * Re-fetch a single Gmail message by its provider ID and re-process its content.
 * Used to recover emails that were stored with empty/broken body content.
 */
export async function refetchGmailMessage(
  accessToken: string,
  refreshToken: string | null | undefined,
  providerMessageId: string,
  senderRules: SyncRule[],
): Promise<ParsedGmailMessage | null> {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken ?? undefined,
  });
  const gmail = google.gmail({ version: "v1", auth: client });
  return fetchMessage(gmail, providerMessageId, senderRules);
}

export type SyncResult = {
  messages: ParsedGmailMessage[];
  historyId: string | null;
  queryUsed: string | null;
  refreshedTokens?: {
    accessToken: string;
    refreshToken?: string;
    expiryDate?: number;
  } | null;
  skippedCount: number;
};

/**
 * Fetch message IDs added since the last historyId using the Gmail history API.
 * Returns null if incremental sync is unavailable (no historyId, expired, etc.)
 * so the caller can fall back to a full query-based sync.
 */
async function fetchIncrementalMessageIds(
  gmail: gmail_v1.Gmail,
  historyId: string,
): Promise<string[] | null> {
  try {
    const messageIds = new Set<string>();
    let pageToken: string | undefined;

    do {
      const history = await gmail.users.history.list({
        userId: "me",
        startHistoryId: historyId,
        historyTypes: ["messageAdded"],
        maxResults: 100,
        pageToken,
      });

      for (const record of history.data.history || []) {
        for (const added of record.messagesAdded || []) {
          if (added.message?.id) {
            messageIds.add(added.message.id);
          }
        }
      }

      pageToken = history.data.nextPageToken || undefined;
    } while (pageToken && messageIds.size < 500);

    return Array.from(messageIds);
  } catch (error: unknown) {
    // Gmail returns 404 when historyId is too old or invalid — fall back to full sync
    const status = (error as { code?: number }).code;
    if (status === 404 || status === 400) {
      return null;
    }
    throw error;
  }
}

export async function syncNewslettersFromGmail(input: {
  accessToken: string;
  refreshToken?: string | null;
  historyId?: string | null;
  rules: SyncRule[];
  /** Optional subset of rules used only to scope the Gmail query.
   *  All of `rules` is still used for per-message detection/filtering.
   *  Use this to run a targeted backfill for a specific sender without
   *  re-querying every other tracked sender. */
  queryRules?: SyncRule[];
}): Promise<SyncResult> {
  const query = buildRuleScopedQuery(input.queryRules ?? input.rules);
  if (!query) {
    return {
      messages: [],
      historyId: input.historyId || null,
      queryUsed: null,
      refreshedTokens: null,
      skippedCount: 0,
    };
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: input.accessToken,
    refresh_token: input.refreshToken || undefined,
  });

  // Capture refreshed tokens when Google's client auto-refreshes
  let refreshedTokens: SyncResult["refreshedTokens"] = null;
  client.on("tokens", (tokens) => {
    refreshedTokens = {
      accessToken: tokens.access_token || input.accessToken,
      refreshToken: tokens.refresh_token || undefined,
      expiryDate: tokens.expiry_date || undefined,
    };
  });

  const gmail = google.gmail({ version: "v1", auth: client });

  // Try incremental sync first, fall back to full query
  let messageIds: string[] = [];
  let usedIncremental = false;

  if (input.historyId) {
    const incrementalIds = await fetchIncrementalMessageIds(gmail, input.historyId);
    if (incrementalIds !== null) {
      messageIds = incrementalIds;
      usedIncremental = true;
    }
  }

  if (!usedIncremental) {
    // Full query-based sync (initial sync or historyId expired)
    let pageToken: string | undefined;
    const rawMessages: gmail_v1.Schema$Message[] = [];

    do {
      const list = await gmail.users.messages.list({
        userId: "me",
        maxResults: 50,
        q: query,
        pageToken,
      });

      rawMessages.push(...(list.data.messages || []));
      pageToken = list.data.nextPageToken || undefined;
    } while (pageToken && rawMessages.length < 500);

    messageIds = rawMessages
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));
  }

  const parsed: ParsedGmailMessage[] = [];
  let skippedCount = 0;

  for (const id of messageIds) {
    try {
      const message = await fetchMessage(gmail, id, input.rules);
      if (message) parsed.push(message);
    } catch (error: unknown) {
      // Skip individual message failures (deleted, permission issues, malformed)
      // instead of crashing the entire sync
      const status = (error as { code?: number }).code;
      if (status === 404 || status === 403) {
        skippedCount++;
        continue;
      }
      // For attachment/MIME parse errors, also skip gracefully
      skippedCount++;
    }
  }

  const profile = await gmail.users.getProfile({ userId: "me" });

  return {
    messages: parsed,
    historyId: profile.data.historyId || input.historyId || null,
    queryUsed: usedIncremental ? `incremental:${input.historyId}` : query,
    refreshedTokens,
    skippedCount,
  };
}


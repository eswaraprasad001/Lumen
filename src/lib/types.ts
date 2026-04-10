export type MessageState =
  | "new"
  | "opened"
  | "in_progress"
  | "saved"
  | "finished"
  | "archived";

export type SenderRuleType = "sender_email" | "sender_domain";
export type SenderRuleAction = "include" | "exclude";
export type SourcePriority = "core" | "normal" | "muted";

export type MessageRecord = {
  id: string;
  sourceId: string;
  sourceName: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  snippet: string;
  category?: string | null;
  receivedAt: string;
  sentAt: string;
  state: MessageState;
  progressPercent: number;
  saved: boolean;
  archived: boolean;
  sanitizedHtmlContent?: string | null;
  textContent?: string | null;
  extractedReadableText?: string | null;
  unsubscribeUrl?: string | null;
  estimatedReadMinutes?: number | null;
  lastScrollPosition?: number | null;
  logoUrl?: string | null;
  bodyExpired?: boolean;
};

export type SourceRecord = {
  id: string;
  displayName: string;
  senderEmail: string;
  senderDomain: string;
  description?: string | null;
  category?: string | null;
  includeRule: boolean;
  excludeRule: boolean;
  priorityLevel: SourcePriority;
  messageCount: number;
  lastReceivedAt: string | null;
  ruleId: string | null;
  ruleLabel: string | null;
  ruleActive: boolean | null;
};

export type SenderRule = {
  id: string;
  ruleType: SenderRuleType;
  value: string;
  action: SenderRuleAction;
  sourceLabel?: string | null;
  createdAt: string;
  active: boolean;
  messageCount: number;
  sourceId: string | null;
};

export type HomeData = {
  mode: "setup" | "live";
  newItems: MessageRecord[];
  newItemsTotal: number;
  continueReading: MessageRecord[];
  selectedSourceItems: MessageRecord[];
  savedItems: MessageRecord[];
  recentlyRead: MessageRecord[];
  isNewUser: boolean;
};

export type LibraryData = {
  mode: "setup" | "live";
  messages: MessageRecord[];
};

export type SourcesData = {
  mode: "setup" | "live";
  sources: SourceRecord[];
  pendingRules: SenderRule[];
};

export type SourceDetailData = {
  mode: "setup" | "live";
  source: SourceRecord;
  messages: MessageRecord[];
};

export type SettingsData = {
  mode: "setup" | "live";
  gmailConnected: boolean;
  lastSyncAt: string | null;
  messageCount: number;
  includeRuleCount: number;
  retentionDays: number;
  metadataRetentionDays: number;
  senderRules: SenderRule[];
  lastError?: string | null;
  userEmail: string | null;
};

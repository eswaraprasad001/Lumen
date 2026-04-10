import { MessageRecord, SenderRule, SourceRecord } from "@/lib/types";
import { estimateReadMinutes } from "@/lib/utils";

const html = (title: string, body: string) =>
  `<h1>${title}</h1><p>${body}</p><p>This demo content stands in for synced Gmail newsletter HTML.</p>`;

export const mockSources: SourceRecord[] = [
  {
    id: "source-1",
    displayName: "The Generalist",
    senderEmail: "weekly@readthegeneralist.com",
    senderDomain: "readthegeneralist.com",
    description: "Long-form business and technology analysis.",
    category: "Markets",
    includeRule: true,
    excludeRule: false,
    priorityLevel: "core",
    messageCount: 2,
    lastReceivedAt: "2026-03-24T08:15:00.000Z",
    ruleId: "rule-1",
    ruleLabel: "Markets",
    ruleActive: true,
  },
  {
    id: "source-2",
    displayName: "Dense Discovery",
    senderEmail: "hi@densediscovery.com",
    senderDomain: "densediscovery.com",
    description: "A design and product reading list.",
    category: "Design",
    includeRule: true,
    excludeRule: false,
    priorityLevel: "normal",
    messageCount: 2,
    lastReceivedAt: "2026-03-23T07:00:00.000Z",
    ruleId: "rule-2",
    ruleLabel: "Design",
    ruleActive: true,
  },
  {
    id: "source-3",
    displayName: "Lenny's Newsletter",
    senderEmail: "newsletter@lennysnewsletter.com",
    senderDomain: "lennysnewsletter.com",
    description: "Product and growth advice for operators and founders.",
    category: "Product",
    includeRule: false,
    excludeRule: false,
    priorityLevel: "core",
    messageCount: 1,
    lastReceivedAt: "2026-03-20T06:30:00.000Z",
    ruleId: null,
    ruleLabel: null,
    ruleActive: null,
  },
];

const baseMessages: Omit<MessageRecord, "estimatedReadMinutes">[] = [
  {
    id: "msg-1",
    sourceId: "source-1",
    sourceName: "The Generalist",
    subject: "The New Shape of AI Distribution",
    fromName: "The Generalist",
    fromEmail: "weekly@readthegeneralist.com",
    snippet:
      "A look at the infrastructure, interfaces, and business moats forming around AI distribution.",
    category: "Markets",
    receivedAt: "2026-03-24T08:15:00.000Z",
    sentAt: "2026-03-24T08:00:00.000Z",
    state: "new",
    progressPercent: 0,
    saved: false,
    archived: false,
    sanitizedHtmlContent: html(
      "The New Shape of AI Distribution",
      "A survey of how product distribution is changing now that AI shifts how people search, discover, and evaluate software.",
    ),
    textContent:
      "A survey of how product distribution is changing now that AI shifts how people search, discover, and evaluate software.",
    extractedReadableText:
      "A survey of how product distribution is changing now that AI shifts how people search, discover, and evaluate software.",
    unsubscribeUrl: "https://example.com/unsubscribe/generalist",
    lastScrollPosition: 0,
  },
  {
    id: "msg-2",
    sourceId: "source-2",
    sourceName: "Dense Discovery",
    subject: "A calmer design systems reading list",
    fromName: "Dense Discovery",
    fromEmail: "hi@densediscovery.com",
    snippet:
      "Patterns for editorial interfaces, reading comfort, and product structure worth borrowing.",
    category: "Design",
    receivedAt: "2026-03-23T07:00:00.000Z",
    sentAt: "2026-03-23T06:45:00.000Z",
    state: "in_progress",
    progressPercent: 42,
    saved: false,
    archived: false,
    sanitizedHtmlContent: html(
      "A calmer design systems reading list",
      "Collected links on typography, editorial layouts, and soft product design patterns.",
    ),
    textContent:
      "Collected links on typography, editorial layouts, and soft product design patterns.",
    extractedReadableText:
      "Collected links on typography, editorial layouts, and soft product design patterns.",
    unsubscribeUrl: "https://example.com/unsubscribe/dense",
    lastScrollPosition: 420,
  },
  {
    id: "msg-3",
    sourceId: "source-3",
    sourceName: "Lenny's Newsletter",
    subject: "Product strategy questions worth asking this quarter",
    fromName: "Lenny's Newsletter",
    fromEmail: "newsletter@lennysnewsletter.com",
    snippet:
      "A framework for evaluating product bets without over-weighting short-term noise.",
    category: "Product",
    receivedAt: "2026-03-20T06:30:00.000Z",
    sentAt: "2026-03-20T06:00:00.000Z",
    state: "saved",
    progressPercent: 18,
    saved: true,
    archived: false,
    sanitizedHtmlContent: html(
      "Product strategy questions worth asking this quarter",
      "A set of strategic prompts for product teams trying to distinguish durable signal from near-term reaction loops.",
    ),
    textContent:
      "A set of strategic prompts for product teams trying to distinguish durable signal from near-term reaction loops.",
    extractedReadableText:
      "A set of strategic prompts for product teams trying to distinguish durable signal from near-term reaction loops.",
    unsubscribeUrl: "https://example.com/unsubscribe/lenny",
    lastScrollPosition: 180,
  },
  {
    id: "msg-4",
    sourceId: "source-1",
    sourceName: "The Generalist",
    subject: "Why niche software still wins",
    fromName: "The Generalist",
    fromEmail: "weekly@readthegeneralist.com",
    snippet:
      "An older issue retained as metadata and short content for demo purposes.",
    category: "Markets",
    receivedAt: "2026-03-16T08:15:00.000Z",
    sentAt: "2026-03-16T08:00:00.000Z",
    state: "finished",
    progressPercent: 100,
    saved: false,
    archived: false,
    sanitizedHtmlContent: html(
      "Why niche software still wins",
      "Smaller software categories still create room for strong businesses when distribution and specificity work together.",
    ),
    textContent:
      "Smaller software categories still create room for strong businesses when distribution and specificity work together.",
    extractedReadableText:
      "Smaller software categories still create room for strong businesses when distribution and specificity work together.",
    unsubscribeUrl: "https://example.com/unsubscribe/generalist",
    lastScrollPosition: 860,
  },
  {
    id: "msg-5",
    sourceId: "source-2",
    sourceName: "Dense Discovery",
    subject: "Three editorial interfaces worth studying",
    fromName: "Dense Discovery",
    fromEmail: "hi@densediscovery.com",
    snippet:
      "Older issue saved as a clean reference, not as an obligation to complete.",
    category: "Design",
    receivedAt: "2026-03-12T07:00:00.000Z",
    sentAt: "2026-03-12T06:45:00.000Z",
    state: "archived",
    progressPercent: 0,
    saved: false,
    archived: true,
    sanitizedHtmlContent: html(
      "Three editorial interfaces worth studying",
      "An annotated list of products with unusual visual structure and thoughtful reading affordances.",
    ),
    textContent:
      "An annotated list of products with unusual visual structure and thoughtful reading affordances.",
    extractedReadableText:
      "An annotated list of products with unusual visual structure and thoughtful reading affordances.",
    unsubscribeUrl: "https://example.com/unsubscribe/dense",
    lastScrollPosition: 0,
  },
];

export const mockMessages: MessageRecord[] = baseMessages.map((message) => ({
  ...message,
  estimatedReadMinutes: estimateReadMinutes(message.textContent || message.snippet),
}));

export const mockSenderRules: SenderRule[] = [
  {
    id: "rule-1",
    ruleType: "sender_email",
    value: "weekly@readthegeneralist.com",
    action: "include",
    sourceLabel: "Markets",
    createdAt: "2026-03-20T12:00:00.000Z",
    active: true,
    messageCount: 2,
    sourceId: "source-1",
  },
  {
    id: "rule-2",
    ruleType: "sender_domain",
    value: "densediscovery.com",
    action: "include",
    sourceLabel: "Design",
    createdAt: "2026-03-20T12:10:00.000Z",
    active: true,
    messageCount: 2,
    sourceId: "source-2",
  },
];

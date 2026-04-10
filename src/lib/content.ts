import sanitizeHtml from "sanitize-html";

import { normalizeDomain, normalizeSenderEmail } from "@/lib/utils";

type HeaderMap = Record<string, string>;
type MimePart = {
  body?: {
    attachmentId?: string | null;
    data?: string | null;
  } | null;
  filename?: string | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
  mimeType?: string | null;
  partId?: string | null;
  parts?: MimePart[] | null;
};

function walkParts(
  payload: MimePart | null | undefined,
  callback: (part: {
    body?: { attachmentId?: string | null; data?: string | null } | null;
    filename?: string | null;
    headers?: Array<{ name?: string | null; value?: string | null }> | null;
    mimeType?: string | null;
    partId?: string | null;
  }) => void,
) {
  if (!payload) return;

  callback(payload);
  if (payload.parts) {
    payload.parts.forEach((part) =>
      walkParts(part as Parameters<typeof walkParts>[0], callback),
    );
  }
}

export function decodeBase64Url(input: string | null | undefined) {
  if (!input) return "";

  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

export function extractBodyByMimeType(
  payload: Parameters<typeof walkParts>[0],
  mimeType: string,
) {
  let result = "";

  walkParts(payload, (part) => {
    if (!result && part.mimeType === mimeType && part.body?.data) {
      result = decodeBase64Url(part.body.data);
    }
  });

  if (!result && payload?.mimeType === mimeType && payload?.body?.data) {
    result = decodeBase64Url(payload.body.data);
  }

  return result;
}

export function flattenMimeParts(payload: MimePart | null | undefined) {
  const parts: Array<{
    body?: { attachmentId?: string | null; data?: string | null } | null;
    filename?: string | null;
    headers: HeaderMap;
    mimeType: string;
    partId?: string | null;
  }> = [];

  walkParts(payload, (part) => {
    parts.push({
      body: part.body,
      filename: part.filename,
      headers: extractHeaders({ headers: part.headers }),
      mimeType: part.mimeType || "application/octet-stream",
      partId: part.partId,
    });
  });

  return parts;
}

export function extractHeaders(
  payload:
    | { headers?: Array<{ name?: string | null; value?: string | null }> | null }
    | null
    | undefined,
) {
  const headers: HeaderMap = {};
  for (const header of payload?.headers || []) {
    if (header.name && header.value) {
      headers[header.name.toLowerCase()] = header.value;
    }
  }
  return headers;
}

export function parseAddressHeader(value: string | null | undefined) {
  if (!value) {
    return {
      fromName: "Unknown sender",
      fromEmail: "",
      senderDomain: "",
    };
  }

  const match = value.match(/^(.*?)(?:<([^>]+)>)?$/);
  const rawName = match?.[1]?.replace(/"/g, "").trim();
  const rawEmail = (match?.[2] || value).trim();
  const email = normalizeSenderEmail(rawEmail);

  return {
    fromName: rawName || email,
    fromEmail: email,
    senderDomain: normalizeDomain(email),
  };
}

// ---------------------------------------------------------------------------
// Platform-specific preprocessors
// ---------------------------------------------------------------------------

export function isSubstackDomain(domain: string) {
  return domain === "substack.com" || domain.endsWith(".substack.com");
}

/**
 * Extracts only the article body from a Substack email, discarding all
 * email-client chrome: the preamble ("Forwarded this email?"), the
 * newsletter header (title, author, date, action buttons, READ IN APP link),
 * and the footer (subscribe prompts, copyright, unsubscribe block).
 *
 * Strategy:
 *  - Strip SVGs first so the READ IN APP ↗ arrow icon doesn't shift indexes.
 *  - Rescue the article's featured image and any CTA button from the header
 *    section — Substack places these before "READ IN APP" even though they are
 *    article content (e.g. a video thumbnail + "Watch now" button).
 *  - The article body starts at the first block element AFTER "READ IN APP".
 *  - The footer starts at the © copyright line and is everything from there on.
 */
export function extractSubstackArticleHtml(html: string): string {
  // 1. Strip SVG elements so downstream icon containers collapse cleanly.
  let result = html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "");

  // 2. Find article start: the first block-level element after "READ IN APP".
  //    Before slicing, rescue any featured image + CTA from the header section.
  const readInAppIdx = result.search(/read\s+in\s+app/i);
  let headerExtras = "";

  if (readInAppIdx !== -1) {
    const headerSection = result.slice(0, readInAppIdx);

    // Rescue featured image: first <img> that isn't a 1px tracker or logo.
    // Substack puts the article hero image early in the email (before the title).
    const imgRegex = /<img\b([^>]*)>/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRegex.exec(headerSection)) !== null) {
      const attrs = imgMatch[1];
      const srcM = attrs.match(/\bsrc=["']([^"']+)["']/i);
      if (!srcM) continue;
      if (!srcM[1].startsWith("http")) continue;
      if (/\bwidth=["']1["']|\bheight=["']1["']/i.test(attrs)) continue;
      if (/spacer|blank|pixel|tracker/i.test(srcM[1])) continue;
      // Skip tiny publisher logo (usually width ≤ 80)
      const wM = attrs.match(/\bwidth=["'](\d+)["']/i);
      if (wM && parseInt(wM[1]) <= 80) continue;
      headerExtras += `<div style="margin-bottom:16px">${imgMatch[0]}</div>`;
      break;
    }

    // Rescue CTA button (e.g. "Watch now", "Read more", "Listen").
    // Email buttons are rendered in three common patterns:
    //  1. <a> with inline background style
    //  2. <td> with bgcolor/background containing an <a>
    //  3. Any <a> whose visible text matches a CTA keyword
    let ctaHtml = "";

    // Pattern 1: styled <a>
    const styledAnchor = headerSection.match(
      /<a\b[^>]*style="[^"]*background[^"]*"[^>]*>[\s\S]*?<\/a>/i,
    );
    if (styledAnchor) {
      ctaHtml = styledAnchor[0];
    }

    // Pattern 2: <td bgcolor> or <td style="background..."> wrapping an <a>
    if (!ctaHtml) {
      const tdMatch = headerSection.match(
        /<td\b[^>]*(?:bgcolor=|style="[^"]*background)[^>]*>([\s\S]*?)<\/td>/i,
      );
      if (tdMatch) {
        const innerA = tdMatch[1].match(/<a\b[^>]*>[\s\S]*?<\/a>/i);
        if (innerA) ctaHtml = innerA[0];
      }
    }

    // Pattern 3: keyword-based — any short link containing a CTA verb
    if (!ctaHtml) {
      const keywordMatch = headerSection.match(
        /<a\b[^>]*href=["'][^"']+["'][^>]*>(?:<[^>]+>)*\s*(?:▶\s*)?(?:watch|read|listen|view|open|play|start)\b[^<]{0,60}(?:<\/[^>]+>)*<\/a>/i,
      );
      if (keywordMatch) ctaHtml = keywordMatch[0];
    }

    if (ctaHtml) {
      // Strip ALL inline styles and classes from the CTA HTML so inner spans
      // don't override the color we set on the <a> wrapper.
      const stripped = ctaHtml
        .replace(/\s+style="[^"]*"/gi, "")
        .replace(/\s+class="[^"]*"/gi, "");
      // Now apply our own button style to the <a>.
      const styledCta = stripped.replace(/<a\b([^>]*)>/i, (_m, attrs) =>
        `<a${attrs} style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#5B7FDB;color:#fff;padding:9px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;box-sizing:border-box">`,
      );
      headerExtras += `<div style="margin:20px 0">${styledCta}</div>`;
    }

    const after = result.slice(readInAppIdx);
    const nextBlock = after.match(/<(p|div|h[1-6]|blockquote|ul|ol)\b/i);
    if (nextBlock?.index !== undefined) {
      result = headerExtras + result.slice(readInAppIdx + nextBlock.index);
    }
  }

  // 3. Strip leading spacer elements at the top of the article body.
  //    Substack inserts <hr> separators and empty <p> / &nbsp; paragraphs
  //    between the header chrome and the article content. Without this,
  //    those spacers render as a large blank gap directly under the title.
  result = result.replace(
    /^(\s*<hr[^>]*\/?>|\s*<br[^>]*\/?>|\s*<p[^>]*>(\s|&nbsp;|&#160;)*<\/p>)*/i,
    "",
  );

  // 4. Strip footer: find the earliest Substack footer marker and cut there.
  //    Markers (in priority order):
  //      a) "Invite your friends" referral block
  //      b) LIKE / COMMENT / RESTACK social bar
  //      c) © copyright line (handles &copy; entity and literal ©)
  const footerPatterns = [
    /invite your friends/i,
    /\blike\b[^<]{0,20}\bcomment\b[^<]{0,20}\brestack\b/i,
    /(?:©|&copy;|&#169;|&#xA9;)\s*\d{4}/,
  ];

  let footerIdx = -1;
  for (const pattern of footerPatterns) {
    const idx = result.search(pattern);
    if (idx !== -1 && (footerIdx === -1 || idx < footerIdx)) {
      footerIdx = idx;
    }
  }

  if (footerIdx !== -1) {
    // Walk back to the opening tag of the element containing the footer marker
    // so we don't leave a dangling opening tag.
    const before = result.slice(0, footerIdx);
    const lastOpen = before.lastIndexOf("<");
    result = lastOpen !== -1 ? result.slice(0, lastOpen) : result.slice(0, footerIdx);
  }

  return result;
}

/**
 * Extracts the publisher's logo/avatar URL from the raw email HTML.
 * Looks in the header section only (before the article content) so we don't
 * accidentally pick up inline article images.
 *
 * For Substack emails, the header section ends at "READ IN APP".
 * For other senders, we scan only the first 4000 characters.
 *
 * Filters out tracking pixels (1×1 images) and non-HTTP sources.
 */
export function extractPublisherLogoUrl(html: string, _senderDomain?: string): string | null {
  // Limit the search region to before any "read in app" CTA — applies to all senders
  const readInAppIdx = html.search(/read\s+in\s+(app|browser|spark|pocket|feedly)/i);
  const searchRegion = readInAppIdx !== -1 ? html.slice(0, readInAppIdx) : html.slice(0, 4000);

  const imgRegex = /<img\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  let firstCandidate: string | null = null;

  while ((match = imgRegex.exec(searchRegion)) !== null) {
    const attrs = match[1];

    // Extract src
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (!src.startsWith("http")) continue;

    // Skip tracking pixels: explicit width/height of 1
    if (/\bwidth=["']1["']/i.test(attrs) || /\bheight=["']1["']/i.test(attrs)) continue;
    if (/\bwidth:\s*1px/i.test(attrs) || /\bheight:\s*1px/i.test(attrs)) continue;

    // Skip spacers and trackers by filename pattern
    if (/spacer|blank|pixel|tracker/i.test(src)) continue;

    // Prefer images explicitly marked as logos or author profile photos
    const isLogoLike =
      /logo/i.test(src) ||
      /\bclass=["'][^"']*logo[^"']*["']/i.test(attrs) ||
      /\balt=["'][^"']*logo[^"']*["']/i.test(attrs);
    if (isLogoLike) return src;

    const isProfileLike =
      /profile|avatar|headshot|author/i.test(src) ||
      /\bclass=["'][^"']*(profile|avatar|author)[^"']*["']/i.test(attrs) ||
      /\balt=["'][^"']*(profile|avatar|author|photo)[^"']*["']/i.test(attrs);
    if (isProfileLike) return src;

    // Reject wide content/banner images — logos are small and roughly square
    const wMatch = attrs.match(/\bwidth=["']?(\d+)/i);
    const hMatch = attrs.match(/\bheight=["']?(\d+)/i);
    const w = wMatch ? parseInt(wMatch[1]) : null;
    const h = hMatch ? parseInt(hMatch[1]) : null;
    if (w && w > 200) continue;           // banner/hero image, skip
    if (h && h > 200) continue;           // tall image, skip
    if (w && h && w / h > 5) continue;    // very wide aspect ratio, skip

    if (!firstCandidate) firstCandidate = src;
  }

  return firstCandidate;
}

// ---------------------------------------------------------------------------
// Main sanitizer
// ---------------------------------------------------------------------------

export function sanitizeNewsletterHtml(
  input: string | null | undefined,
  senderDomain?: string,
) {
  if (!input) return null;

  // Apply platform-specific preprocessing before generic sanitization.
  // This strips email-client chrome (headers, action bars, footers) that
  // would otherwise pollute the reader view.
  let preprocessed = input;
  if (senderDomain && isSubstackDomain(senderDomain)) {
    const extracted = extractSubstackArticleHtml(input);
    // If the extractor yielded too little (copyright or marker heuristic over-
    // stripped the content), fall back to generic SVG-stripped sanitization so
    // we always store something readable rather than an empty body.
    preprocessed = extracted.trim().length > 200
      ? extracted
      : input.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "");
  } else {
    // Generic fallback for all other platforms: strip SVGs early so their
    // styled container elements don't leave hollow shells after sanitization.
    preprocessed = input.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "");
  }

  const sanitized = sanitizeHtml(preprocessed, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "h3",
      "section",
      "article",
      "figure",
      "figcaption",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "width", "height"],
      a: ["href", "target", "rel", "style"],
      "*": ["style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noreferrer noopener",
        target: "_blank",
      }),
    },
  });

  // Remove elements that became empty after SVG/chrome stripping.
  // Multiple passes handle nested containers (e.g. <div><a></a></div>).
  let prev = "";
  let result = sanitized;
  while (result !== prev) {
    prev = result;
    result = result
      .replace(/<a([^>]*)>\s*<\/a>/g, "")
      .replace(/<(div|span)[^>]*>\s*<\/(div|span)>/g, "");
  }
  return result;
}

export function htmlToText(input: string | null | undefined) {
  if (!input) return "";
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeContentId(contentId: string | null | undefined) {
  if (!contentId) return null;
  return contentId.trim().replace(/^<|>$/g, "").toLowerCase();
}

export function replaceCidUrls(
  html: string,
  cidToDataUrl: Map<string, string>,
) {
  return html.replace(/(["'(])cid:([^"')>\s]+)/gi, (match, prefix, cid) => {
    const resolved = cidToDataUrl.get(normalizeContentId(cid) || "");
    return resolved ? `${prefix}${resolved}` : match;
  });
}

function normalizeComparableText(input: string) {
  return htmlToText(input)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripDuplicateLeadingHeading(
  html: string | null | undefined,
  subject: string,
) {
  if (!html) return null;

  const normalizedSubject = normalizeComparableText(subject);
  if (!normalizedSubject) return html;

  let removed = false;
  return html.replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/i, (match, _level, inner) => {
    if (removed) return match;

    if (normalizeComparableText(inner) === normalizedSubject) {
      removed = true;
      return "";
    }

    return match;
  });
}

export function detectNewsletter(
  headers: HeaderMap,
  fromEmail: string,
  senderDomain: string,
  rules: Array<{ ruleType: string; value: string; action: "include" | "exclude" }>,
) {
  const normalizedEmail = normalizeSenderEmail(fromEmail);
  const normalizedDomain = normalizeDomain(senderDomain);

  const matchingRule = rules.find((rule) => {
    if (rule.ruleType === "sender_email") {
      return normalizeSenderEmail(rule.value) === normalizedEmail;
    }

    // Match exact domain or any subdomain — e.g. rule "substack.com"
    // matches both "substack.com" and "mail.substack.com"
    const ruleDomain = normalizeDomain(rule.value);
    return (
      normalizedDomain === ruleDomain ||
      normalizedDomain.endsWith(`.${ruleDomain}`)
    );
  });

  if (matchingRule) {
    return {
      shouldInclude: matchingRule.action === "include",
      detectionMethod: `manual_${matchingRule.action}`,
    };
  }

  // When the user has explicit rules defined, only include messages that
  // match those rules — do not fall back to header heuristics.
  // Heuristics only apply when no rules are configured at all.
  if (rules.length > 0) {
    return { shouldInclude: false, detectionMethod: "unknown" };
  }

  const hasNewsletterHeaders =
    Boolean(headers["list-unsubscribe"]) ||
    Boolean(headers["list-id"]) ||
    headers["precedence"]?.toLowerCase() === "bulk";

  return {
    shouldInclude: hasNewsletterHeaders,
    detectionMethod: hasNewsletterHeaders ? "header_heuristic" : "unknown",
  };
}

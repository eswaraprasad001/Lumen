import Link from "next/link";

import { format } from "date-fns";

import { ReaderProgress } from "@/components/reader-progress";
import { SetupState } from "@/components/setup-state";
import { extractSubstackArticleHtml, isSubstackDomain, stripDuplicateLeadingHeading } from "@/lib/content";
import { requireAuth } from "@/lib/auth";
import { getMessageData } from "@/lib/data";
import { appEnv } from "@/lib/env";

type ReaderPageProps = {
  params: Promise<{ messageId: string }>;
};

export default async function ReaderPage({ params }: ReaderPageProps) {
  await requireAuth();
  const { messageId } = await params;
  const message = await getMessageData(messageId);

  if (!message) {
    return <SetupState page="reader" />;
  }

  // For emails already stored without Substack preprocessing, apply the
  // platform-specific cleaner at read time so chrome is removed retroactively.
  // Fall back to the original stored HTML if preprocessing yields too little
  // content (e.g. the stored format doesn't contain the expected markers).
  const senderDomain = message.fromEmail.split("@")[1] ?? "";
  const stored = message.sanitizedHtmlContent ?? "";
  const fallbackText = message.extractedReadableText || message.textContent || message.snippet || "";
  let preprocessedHtml = stored;
  // Only apply the Substack extractor if the stored HTML still contains the
  // header chrome marker. Emails already processed at sync time won't have
  // "READ IN APP", so applying the extractor again would run the copyright
  // regex against the article body and cut off legitimate content.
  if (isSubstackDomain(senderDomain) && /read\s+in\s+app/i.test(stored)) {
    const extracted = extractSubstackArticleHtml(stored);
    preprocessedHtml = extracted.trim().length > 100 ? extracted : stored;
  }

  const articleHtml = stripDuplicateLeadingHeading(preprocessedHtml, message.subject);

  return (
    <>
      <section className="page-header" style={{ marginBottom: "18px" }}>
        <div>
          <span className="eyebrow">Reader</span>
          <p style={{ marginTop: "12px", wordBreak: "break-word", lineHeight: 1.5 }}>
            {message.sourceName} · {format(new Date(message.receivedAt), "MMMM d, yyyy")}
          </p>
        </div>
      </section>

      <section className="reader-shell">
        <div className="reader-topbar">
          <div>
            <div className="badge-row">
              <span className="badge">{message.state === "new" ? "New" : message.state.replace("_", " ")}</span>
              {message.estimatedReadMinutes ? (
                <span className="badge badge-muted">
                  {message.estimatedReadMinutes} min read
                </span>
              ) : null}
              {message.unsubscribeUrl ? (
                <Link
                  href={message.unsubscribeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="badge badge-muted"
                >
                  Unsubscribe link
                </Link>
              ) : null}
            </div>
          </div>
          <ReaderProgress message={message} />
        </div>

        <div className="reader-content">
          <article>
            <h1 className="reader-title">{message.subject}</h1>
            {articleHtml ? (
              <div
                dangerouslySetInnerHTML={{
                  __html: articleHtml,
                }}
              />
            ) : null}

            {!articleHtml && fallbackText ? (
              <div
                dangerouslySetInnerHTML={{
                  __html: fallbackText
                    .replace(/&amp;/g, "&")
                    .replace(/&#39;/g, "'")
                    .replace(/&quot;/g, '"')
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">"),
                }}
                style={{ whiteSpace: "pre-line" }}
              />
            ) : null}

            {!articleHtml && !fallbackText && message.bodyExpired ? (
              <div className="body-expired-notice">
                <p className="body-expired-title">Content no longer available</p>
                <p className="body-expired-sub">
                  The full body of this newsletter is retained for{" "}
                  {appEnv.retentionDays} days. This
                  issue is older than that window — only the title and metadata
                  are kept.
                </p>
              </div>
            ) : null}

            {/* <RefreshContentButton messageId={message.id} /> */}
          </article>
        </div>
      </section>
    </>
  );
}

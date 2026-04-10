"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";

import { DeleteMessageButton } from "@/components/delete-message-button";
import { NewsletterIcon } from "@/components/newsletter-icon";
import { decodeHtmlEntities } from "@/lib/format";
import { MessageRecord } from "@/lib/types";

type NewsletterCardProps = {
  message: MessageRecord;
  showDelete?: boolean;
};

function getStateLabel(message: MessageRecord) {
  if (message.archived) return "Archived";
  if (message.saved) return "Saved";
  if (message.state === "in_progress") return message.progressPercent > 0 ? `${message.progressPercent}% read` : "Reading";
  if (message.state === "opened") return "Opened";
  if (message.state === "finished") return "Finished";
  return "New";
}

export function NewsletterCard({ message, showDelete }: NewsletterCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const domain = message.fromEmail.split("@")[1] ?? "";
  const href = `/reader/${message.id}`;

  function navigate(e: React.MouseEvent) {
    if ((e as React.MouseEvent<HTMLAnchorElement>).metaKey || (e as React.MouseEvent<HTMLAnchorElement>).ctrlKey) return;
    e.preventDefault();
    startTransition(() => router.push(href));
  }

  return (
    <article className={`message-card${isPending ? " card-loading" : ""}`} style={{ position: "relative" }}>
      {isPending && <span className="card-progress-bar" aria-hidden />}

      {/* Top-right: delete icon in library */}
      <div className="card-corner">
        {showDelete && !isPending ? (
          <DeleteMessageButton messageId={message.id} />
        ) : null}
      </div>

      <div className="message-meta">
        <NewsletterIcon logoUrl={message.logoUrl} domain={domain} name={message.sourceName} size={28} />
        <div className="meta-text">
          <span className="meta-source" title={message.sourceName}>{message.sourceName}</span>
          <span className="meta-time">{formatDistanceToNowStrict(new Date(message.receivedAt), { addSuffix: true })}</span>
        </div>
      </div>

      <h3>
        <a href={href} onClick={navigate}>
          {decodeHtmlEntities(message.subject)}
        </a>
      </h3>
      <p>{decodeHtmlEntities(message.snippet)}</p>

      <div className="message-footer">
        <div className="badge-row">
          <span className="badge">{getStateLabel(message)}</span>
          {message.category ? (
            <span className="badge badge-muted">{message.category}</span>
          ) : null}
          {message.estimatedReadMinutes ? (
            <span className="badge badge-muted">
              {message.estimatedReadMinutes} min read
            </span>
          ) : null}
        </div>

        <a href={href} onClick={navigate} className="button-secondary">
          Open
        </a>
      </div>
    </article>
  );
}

"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { SaveToFolderButton } from "@/components/save-to-folder-button";
import { MessageRecord } from "@/lib/types";

type ReaderProgressProps = {
  message: MessageRecord;
};

async function postState(messageId: string, payload: Record<string, unknown>): Promise<string | null> {
  const response = await fetch(`/api/messages/${messageId}/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.ok) return null;

  try {
    const data = await response.json();
    return data.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export function ReaderProgress({ message }: ReaderProgressProps) {
  const lastPercentRef = useRef(message.progressPercent);
  const restoredScrollRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [stateLabel, setStateLabel] = useState(() => {
    if (message.archived) return "Archived";
    if (message.saved) return "Saved";
    if (message.state === "finished") return "Finished";
    if (message.state === "opened") return "Opened";
    if (message.state === "in_progress") return "Reading";
    return "New";
  });

  const lastSentAtRef = useRef<number>(0);

  const sendScrollState = useCallback(async (progressPercent: number) => {
    if (Math.abs(progressPercent - lastPercentRef.current) < 5) return;

    const now = Date.now();
    if (now - lastSentAtRef.current < 400) return; // throttle to avoid spam

    lastPercentRef.current = progressPercent;
    lastSentAtRef.current = now;

    if (progressPercent > 0) {
      setStateLabel((prev) =>
        prev === "New" || prev === "Opened" ? "Reading" : prev,
      );
    }

    await postState(message.id, {
      state: progressPercent > 0 ? "in_progress" : "opened",
      progressPercent,
      lastScrollPosition: window.scrollY,
    });
  }, [message.id]);

  useEffect(() => {
    if (!restoredScrollRef.current && message.lastScrollPosition && message.lastScrollPosition > 0) {
      restoredScrollRef.current = true;
      requestAnimationFrame(() => {
        window.scrollTo({ top: message.lastScrollPosition || 0, behavior: "instant" });
      });
    }

    // Initial state update on open — fail silently so a transient auth
    // or network issue doesn't show an error badge the user can't dismiss.
    void postState(message.id, {
      ...(message.state === "new" ? { state: "opened" } : {}),
      progressPercent: message.progressPercent,
      lastScrollPosition: message.lastScrollPosition ?? 0,
    }); // fire-and-forget, errors ignored on auto-open

    const handleScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;

      const progressPercent = Math.max(
        1,
        Math.min(100, Math.round((window.scrollY / scrollable) * 100)),
      );

      void sendScrollState(progressPercent);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [message.id, message.lastScrollPosition, message.progressPercent, message.state, sendScrollState]);

  async function applyAction(payload: Record<string, unknown>, label: string) {
    startTransition(async () => {
      const err = await postState(message.id, payload);
      if (!err) {
        setError(null);
        setStateLabel(label);
      } else {
        setError(err);
      }
    });
  }

  return (
    <div className="reader-actions">
      <span className="badge badge-muted">{stateLabel}</span>
      {error ? <span className="badge badge-muted" style={{ background: "rgba(131,53,43,0.08)", color: "#7b3f34" }}>{error}</span> : null}
      <SaveToFolderButton
        messageId={message.id}
        isSaved={message.saved}
        onSaved={() => setStateLabel("Saved")}
      />
      <button
        className="button-secondary"
        onClick={() =>
          void applyAction(
            { state: "finished", progressPercent: 100, saved: false },
            "Finished",
          )
        }
      >
        Finish
      </button>
      <button
        className="button-ghost"
        onClick={() =>
          void applyAction(
            { archived: true, saved: false },
            "Archived",
          )
        }
      >
        Archive
      </button>
    </div>
  );
}

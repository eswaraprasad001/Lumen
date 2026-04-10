"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteMessageButtonProps = {
  messageId: string;
};

export function DeleteMessageButton({ messageId }: DeleteMessageButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const res = await fetch(`/api/messages/${messageId}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span className="delete-confirm-popover">
        <button className="delete-confirm-yes" onClick={handleDelete} disabled={loading}>
          {loading ? "…" : "Delete"}
        </button>
        <button className="delete-confirm-no" onClick={() => setConfirming(false)} disabled={loading}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      className="card-delete-btn"
      onClick={(e) => { e.preventDefault(); setConfirming(true); }}
      aria-label="Delete article"
      title="Delete"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M1 3h12M5 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M11 3l-.867 8.2A1 1 0 0 1 9.14 12H4.86a1 1 0 0 1-.994-.8L3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

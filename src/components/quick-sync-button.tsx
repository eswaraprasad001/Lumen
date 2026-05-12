"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

export function QuickSyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  async function handleSync() {
    setLoading(true);
    setDone(false);
    setError(null);
    setNeedsReconnect(false);
    startTransition(async () => {
      try {
        const response = await fetch("/api/sync/run", { method: "POST" });
        const data = await response.json() as { ok: boolean; error?: string };
        if (data.ok) {
          setDone(true);
          router.refresh();
          setTimeout(() => setDone(false), 3000);
        } else {
          const msg = data.error ?? "Sync failed. Please try again.";
          const isExpired = /expired|invalid_grant|reconnect/i.test(msg);
          setNeedsReconnect(isExpired);
          setError(isExpired ? "Gmail token expired." : msg);
        }
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    });
  }

  return (
    <div className="quick-sync-wrap">
      <button
        className={`quick-sync-btn${error ? " quick-sync-btn-error" : ""}`}
        onClick={handleSync}
        disabled={loading}
        title="Sync tracked senders"
      >
        <span className={`quick-sync-icon${loading ? " spinning" : ""}`}>
          ↻
        </span>
        {loading ? "Syncing…" : done ? "Up to date" : "Sync"}
      </button>
      {error && (
        <span className="quick-sync-error">
          {error}
          {needsReconnect && (
            <a href="/settings?reconnect=gmail" className="quick-sync-reconnect-link">
              Reconnect Gmail →
            </a>
          )}
        </span>
      )}
    </div>
  );
}

"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

export function QuickSyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSync() {
    setLoading(true);
    setDone(false);
    startTransition(async () => {
      const response = await fetch("/api/sync/run", { method: "POST" });
      setLoading(false);
      if (response.ok) {
        setDone(true);
        router.refresh();
        setTimeout(() => setDone(false), 3000);
      }
    });
  }

  return (
    <button
      className="quick-sync-btn"
      onClick={handleSync}
      disabled={loading}
      title="Sync tracked senders"
    >
      <span className={`quick-sync-icon${loading ? " spinning" : ""}`}>
        ↻
      </span>
      {loading ? "Syncing…" : done ? "Up to date" : "Sync"}
    </button>
  );
}

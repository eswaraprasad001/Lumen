"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshContentButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/messages/${messageId}/refresh`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to refresh content.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ margin: "16px 0" }}>
      <p style={{ marginBottom: "8px", opacity: 0.6, fontSize: "0.9rem" }}>
        Full content was not stored for this email.
      </p>
      <button className="button-secondary" onClick={handleRefresh} disabled={loading}>
        {loading ? "Fetching from Gmail…" : "Refresh content from Gmail"}
      </button>
      {error ? <p style={{ marginTop: "8px", color: "#7b3f34", fontSize: "0.85rem" }}>{error}</p> : null}
    </div>
  );
}

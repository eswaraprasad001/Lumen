"use client";

import { ReactNode, startTransition, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

function SyncElapsedCircle({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 200);
    return () => clearInterval(id);
  }, [startedAt]);

  const size = 52;
  const r = 20;
  const circ = 2 * Math.PI * r;
  // Spin around every 30s so it always looks like it's progressing
  const dashOffset = circ - (circ * (elapsed % 30)) / 30;

  return (
    <div className="sync-elapsed-wrap" title={`Syncing… ${elapsed}s`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="sync-elapsed-label">{elapsed}s</span>
    </div>
  );
}

import { SenderRule } from "@/lib/types";

type SettingsPanelProps = {
  gmailConnected: boolean;
  lastSyncAt: string | null;
  messageCount: number;
  includeRuleCount: number;
  senderRules: SenderRule[];
  retentionDays: number;
  metadataRetentionDays: number;
  userEmail: string | null;
  lastError?: string | null;
  mode: "setup" | "live";
  signOutButton?: ReactNode;
};

export function SettingsPanel({
  gmailConnected,
  lastSyncAt,
  senderRules,
  retentionDays,
  metadataRetentionDays,
  userEmail,
  lastError,
  signOutButton,
}: SettingsPanelProps) {
  const router = useRouter();
  const gmailAuthExpired = Boolean(lastError && /expired|invalid_grant/i.test(lastError));
  const [toast, setToast] = useState<{ message: string; section: "left" | "right" } | null>(
    gmailAuthExpired
      ? { message: "Gmail connection expired — please reconnect.", section: "left" }
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const ruleFormRef = useRef<HTMLFormElement>(null);

  function flash(message: string, section: "left" | "right" = "left", ms = 4000) {
    setToast({ message, section });
    setTimeout(() => setToast(null), ms);
  }

  async function handleSync() {
    setLoading(true);
    setSyncStartedAt(Date.now());
    startTransition(async () => {
      const response = await fetch("/api/sync/run", { method: "POST" });
      const payload = (await response.json()) as { message?: string; error?: string };
      setSyncStartedAt(null);
      if (response.ok) {
        router.refresh();
      } else {
        flash(payload.error || "Sync failed. Please try again.", "left");
      }
      setLoading(false);
    });
  }

  async function handleConnect() {
    setLoading(true);
    startTransition(async () => {
      const response = await fetch("/api/integrations/gmail/connect", { method: "POST" });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      flash(payload.error || "Unable to start Gmail connection.", "left");
      setLoading(false);
    });
  }

  async function handleDisconnect() {
    setLoading(true);
    startTransition(async () => {
      const response = await fetch("/api/integrations/gmail", { method: "DELETE" });
      const payload = (await response.json()) as { message?: string; error?: string };
      flash(payload.message || payload.error || "Connection removed.", "left");
      if (response.ok) router.refresh();
      setLoading(false);
    });
  }

  async function handleDeleteData() {
    setLoading(true);
    startTransition(async () => {
      const response = await fetch("/api/user/data", { method: "DELETE" });
      const payload = (await response.json()) as { message?: string; error?: string };
      flash(payload.message || payload.error || "Data deleted.", "right");
      if (response.ok) router.refresh();
      setLoading(false);
    });
  }

  async function handleDeleteAccount() {
    setLoading(true);
    startTransition(async () => {
      const response = await fetch("/api/user/account", { method: "DELETE" });
      if (response.ok) {
        window.location.href = "/login";
      } else {
        const payload = (await response.json()) as { error?: string };
        flash(payload.error || "Failed to delete account.", "right");
        setLoading(false);
        setConfirmDeleteAccount(false);
      }
    });
  }

  async function handleDeleteRule(ruleId: string) {
    setDeletingRuleId(ruleId);
    startTransition(async () => {
      const response = await fetch(`/api/sender-rules/${ruleId}`, { method: "DELETE" });
      const payload = (await response.json()) as { message?: string; error?: string };
      flash(payload.message || payload.error || "Rule deleted.", "right");
      if (response.ok) router.refresh();
      setDeletingRuleId(null);
    });
  }

  async function handleRuleSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    const form = ruleFormRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const body = {
      ruleType: formData.get("ruleType"),
      value: formData.get("value"),
      action: formData.get("action"),
      sourceLabel: formData.get("sourceLabel"),
    };
    setLoading(true);
    startTransition(async () => {
      const response = await fetch("/api/sender-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { message?: string; error?: string };
      flash(payload.message || payload.error || "Rule saved.", "right");
      if (response.ok) router.refresh();
      setLoading(false);
      form.reset();
    });
  }

  return (
    <div className="settings-grid">

      {/* ── Left panel ── */}
      <section className="settings-panel">
        <header>
          <div>
            <h2>Connection and sync</h2>
          </div>
          {toast?.section === "left" ? (
            <span className="section-toast">
              <span className="status-flash-icon">✓</span>
              {toast.message}
            </span>
          ) : null}
        </header>

        <div className="rule-list">
          {/* Syncing from */}
          {userEmail ? (
            <div className="rule-item">
              <div className="gmail-account-display">
                <span className="gmail-icon-badge" aria-hidden>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="currentColor" opacity=".9"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor" opacity=".7"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="currentColor" opacity=".5"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor" opacity=".8"/>
                  </svg>
                </span>
                <div>
                  <strong style={{ fontSize: "0.875rem" }}>Syncing from</strong>
                  <p className="muted-note" style={{ marginTop: 2 }}>{userEmail}</p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Gmail status */}
          <div className={`rule-item${gmailAuthExpired ? " rule-item-warning" : ""}`}>
            <div>
              <strong>
                {gmailAuthExpired
                  ? "Gmail — reconnection required"
                  : gmailConnected
                  ? "Gmail connected"
                  : "Gmail not connected"}
              </strong>
              <p className="muted-note">
                {gmailAuthExpired
                  ? "The Gmail connection has expired. Reconnect to resume syncing."
                  : gmailConnected
                  ? `Last sync: ${lastSyncAt ? format(new Date(lastSyncAt), "MMM d, yyyy · h:mm a") : "Not yet synced"}`
                  : "Connect Gmail to start syncing newsletters."}
              </p>
            </div>
            <div className="toolbar">
              {gmailAuthExpired ? (
                <button className="button" onClick={handleConnect} disabled={loading}>
                  Reconnect Gmail
                </button>
              ) : gmailConnected ? (
                <>
                  <button className="button-secondary" onClick={handleDisconnect} disabled={loading}>
                    Disconnect
                  </button>
                  {syncStartedAt ? (
                    <SyncElapsedCircle startedAt={syncStartedAt} />
                  ) : (
                    <button className="button-secondary" onClick={handleSync} disabled={loading}>
                      Sync now
                    </button>
                  )}
                </>
              ) : (
                <button className="button" onClick={handleConnect} disabled={loading}>
                  Connect Gmail
                </button>
              )}
            </div>
          </div>

          {/* Sync error */}
          {lastError && !gmailAuthExpired ? (
            <div className="rule-item">
              <div>
                <strong>Latest sync issue</strong>
                <p className="muted-note">{lastError}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="separator" />

        {/* Account */}
        <div className="account-section">
          <h2 className="account-section-title">Account</h2>

          {/* Session row */}
          {signOutButton ? (
            <div className="rule-item">
              <div>
                <strong>Session</strong>
                {userEmail ? (
                  <p className="muted-note">{userEmail}</p>
                ) : null}
              </div>
              {signOutButton}
            </div>
          ) : null}

          {/* Retention row */}
          <div className="rule-item">
            <div>
              <strong>Data retention</strong>
              <p className="muted-note">
                Newsletters are fully readable for <strong>{retentionDays} days</strong>. After that, only the sender
                and subject are kept as a reference for up to <strong>{metadataRetentionDays} days</strong> — then
                everything is permanently removed.
              </p>
            </div>
          </div>

          {/* Delete actions */}
          <div className="rule-item">
            <div>
              <strong>Delete newsletter data</strong>
              <p className="muted-note">Removes all synced content. Your rules and account stay intact.</p>
            </div>
            <button className="button-danger-sm" onClick={handleDeleteData} disabled={loading}>
              Delete data
            </button>
          </div>

          <div className="rule-item">
            <div>
              <strong>Delete account</strong>
              <p className="muted-note">Permanently erases your account and all associated data.</p>
            </div>
            {confirmDeleteAccount ? (
              <div className="toolbar">
                <button className="button-secondary" onClick={() => setConfirmDeleteAccount(false)} disabled={loading}>
                  Cancel
                </button>
                <button className="button-danger-sm" onClick={handleDeleteAccount} disabled={loading}>
                  {loading ? "Deleting…" : "Confirm"}
                </button>
              </div>
            ) : (
              <button className="button-danger-sm" onClick={() => setConfirmDeleteAccount(true)} disabled={loading}>
                Delete account
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Right panel ── */}
      <section className="settings-panel">
        <header>
          <div>
            <h2>Sender rules</h2>
            <p className="rule-stats">
              <span className="rule-stat">
                <span className="rule-stat-count">{senderRules.filter(r => r.action === "include").length}</span>
                {senderRules.filter(r => r.action === "include").length === 1 ? "tracked sender" : "tracked senders"}
              </span>
              <span className="rule-stat-divider">·</span>
              <span className="rule-stat">
                <span className="rule-stat-count">{senderRules.filter(r => r.action === "exclude").length}</span>
                excluded
              </span>
            </p>
          </div>
          {toast?.section === "right" ? (
            <span className="section-toast">
              <span className="status-flash-icon">✓</span>
              {toast.message}
            </span>
          ) : null}
        </header>

        {/* Add rule form */}
        <form ref={ruleFormRef} className="stack" onSubmit={handleRuleSubmit}>
          <div className="rule-form-row">
            <select name="ruleType" className="select" defaultValue="sender_email">
              <option value="sender_email">Sender email</option>
              <option value="sender_domain">Sender domain</option>
            </select>
            <select name="action" className="select" defaultValue="include">
              <option value="include">Always include</option>
              <option value="exclude">Always exclude</option>
            </select>
          </div>
          <div className="rule-form-row">
            <input
              className="input"
              name="value"
              placeholder="newsletter@example.com or substack.com"
              required
            />
            <input
              className="input"
              name="sourceLabel"
              placeholder="Label (optional)"
            />
          </div>
          <button className="button" type="submit" disabled={loading}>
            Add rule
          </button>
        </form>

        <div className="separator" />

        <div className="rule-list">
          {senderRules.length > 0 ? (
            <>
              {senderRules.slice(0, 4).map((rule) => (
                <div key={rule.id}>
                  <div className={`rule-item${!rule.active ? " rule-item-inactive" : ""}`}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <strong style={{ opacity: rule.active ? 1 : 0.5 }}>{rule.value}</strong>
                        {rule.messageCount > 0 ? (
                          <span className="muted-note" style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                            {rule.messageCount} {rule.messageCount === 1 ? "issue" : "issues"}
                          </span>
                        ) : null}
                      </div>
                      <div className="muted-note" style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: 2 }}>
                        <span>
                          {rule.ruleType === "sender_domain" ? "Domain" : "Email"} •{" "}
                          {rule.action === "include" ? "Always include" : "Always exclude"}
                          {!rule.active ? " • Paused" : ""}
                        </span>
                        {rule.sourceLabel ? (
                          <span className="badge badge-muted">{rule.sourceLabel}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="toolbar">
                      <button
                        className="button-ghost"
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={deletingRuleId !== null}
                        title="Delete rule"
                        style={{ minWidth: 28, minHeight: 28 }}
                      >
                        {deletingRuleId === rule.id
                          ? <span className="inline-spinner" aria-hidden />
                          : "✕"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <a href="/sources" className="rules-view-all">
                Go to Sources to edit labels, pause, or delete rules →
              </a>
            </>
          ) : (
            <div className="empty-card">
              <p>No rules yet. Add a sender email or domain to start syncing.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

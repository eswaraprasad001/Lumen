"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, startTransition } from "react";

import { SourceRecord } from "@/lib/types";
import { LoadingLink } from "@/components/loading-link";

type SourceCardProps = {
  source: SourceRecord;
};

export function SourceCard({ source }: SourceCardProps) {
  const router = useRouter();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(source.ruleLabel ?? "");
  const [loading, setLoading] = useState(false);
  const [pendingActivate, setPendingActivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [optimisticActive, setOptimisticActive] = useState(source.ruleActive);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleToggleRule() {
    if (!source.ruleId) return;
    if (optimisticActive === false) {
      // Turning ON — show the catch-up/fresh prompt
      setPendingActivate(true);
      return;
    }
    // Turning OFF — deactivate immediately
    setOptimisticActive(false);
    setLoading(true);
    startTransition(async () => {
      await fetch(`/api/sender-rules/${source.ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      router.refresh();
      setLoading(false);
    });
  }

  async function handleActivateRule(mode: "catchup" | "fresh") {
    if (!source.ruleId) return;
    setPendingActivate(false);
    setOptimisticActive(true);
    setLoading(true);
    startTransition(async () => {
      await fetch(`/api/sender-rules/${source.ruleId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      router.refresh();
      setLoading(false);
    });
  }

  async function handleDeleteRule() {
    if (!source.ruleId) return;
    setConfirmDelete(false);
    setLoading(true);
    startTransition(async () => {
      await fetch(`/api/sender-rules/${source.ruleId}`, { method: "DELETE" });
      router.refresh();
      setLoading(false);
    });
  }

  async function handleSaveLabel() {
    if (!source.ruleId) return;
    setLoading(true);
    startTransition(async () => {
      await fetch(`/api/sender-rules/${source.ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLabel: labelValue }),
      });
      setEditingLabel(false);
      router.refresh();
      setLoading(false);
    });
  }

  function startEditing() {
    setEditingLabel(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <>
    <article className="source-card">
      <div className="source-header">
        <div>
          <span>{source.senderEmail}</span>
          <h2 style={{ marginTop: "8px" }}>
            <LoadingLink href={`/sources/${source.id}`} showSpinner>
              {source.displayName}
            </LoadingLink>
          </h2>
        </div>
        <span>{source.messageCount} issues</span>
      </div>

      <p style={{ marginTop: "12px" }}>
        {source.description ||
          "A tracked newsletter source with a dedicated archive and sender-level controls."}
      </p>

      <div className="source-stats">
        {source.includeRule ? (
          <span className="badge badge-tracked">Tracked</span>
        ) : source.excludeRule ? (
          <span className="badge badge-muted">Excluded</span>
        ) : (
          <span className="badge badge-untracked">Untracked</span>
        )}
        {source.category ? (
          <span className="badge badge-muted">{source.category}</span>
        ) : null}
      </div>

      {source.ruleId ? (
        <div className="source-actions">
          {editingLabel ? (
            <div className="source-label-edit">
              <input
                ref={inputRef}
                className="input"
                value={labelValue}
                onChange={(e) => setLabelValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveLabel(); if (e.key === "Escape") setEditingLabel(false); }}
                placeholder="e.g. Essays or Markets"
                disabled={loading}
                style={{ fontSize: "0.85rem", padding: "6px 12px" }}
              />
              <button className="source-icon-btn" onClick={handleSaveLabel} disabled={loading} title="Save label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button className="source-icon-btn" onClick={() => setEditingLabel(false)} disabled={loading} title="Cancel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : (
            <>
              <div className="source-action-row">
                <span className="source-label-text">{source.ruleLabel || <span className="source-label-empty">No label</span>}</span>
                <button className="source-icon-btn" onClick={startEditing} disabled={loading} title="Edit label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button className="source-icon-btn source-icon-danger" onClick={() => setConfirmDelete(true)} disabled={loading} title="Remove rule">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
                {source.ruleActive !== null ? (
                  <button
                    className={`rule-toggle${optimisticActive ? " rule-toggle-on" : " rule-toggle-off"}${loading ? " rule-toggle-loading" : ""}`}
                    onClick={handleToggleRule}
                    disabled={loading}
                    title={optimisticActive ? "Pause this rule" : "Activate this rule"}
                  >
                    {loading ? <span className="rule-toggle-spinner" /> : <span className="rule-toggle-knob" />}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </article>

    {confirmDelete ? (
      <div className="onboarding-backdrop" onClick={() => setConfirmDelete(false)}>
        <div className="activate-modal" onClick={(e) => e.stopPropagation()}>
          <button className="onboarding-close" onClick={() => setConfirmDelete(false)} aria-label="Cancel">✕</button>
          <div className="activate-modal-header">
            <h2>Remove rule</h2>
            <p>
              This will permanently delete the tracking rule for <strong>{source.displayName}</strong> and remove all{" "}
              <strong>{source.messageCount} issue{source.messageCount === 1 ? "" : "s"}</strong> synced from this source. This cannot be undone.
            </p>
          </div>
          <div className="activate-modal-options">
            <button className="activate-option activate-option-danger" onClick={handleDeleteRule} disabled={loading}>
              <strong>Yes, delete rule and content</strong>
              <span>Removes the rule and all {source.messageCount} synced newsletter{source.messageCount === 1 ? "" : "s"} from your library.</span>
            </button>
            <button className="activate-option" onClick={() => setConfirmDelete(false)} disabled={loading}>
              <strong>Cancel</strong>
              <span>Keep the rule and its content intact.</span>
            </button>
          </div>
        </div>
      </div>
    ) : null}

    {pendingActivate ? (
      <div className="onboarding-backdrop" onClick={() => setPendingActivate(false)}>
        <div className="activate-modal" onClick={(e) => e.stopPropagation()}>
          <button className="onboarding-close" onClick={() => setPendingActivate(false)} aria-label="Cancel">✕</button>
          <div className="activate-modal-header">
            <h2>Resume tracking</h2>
            <p>Choose how to sync <strong>{source.displayName}</strong> after being paused.</p>
          </div>
          <div className="activate-modal-options">
            <button className="activate-option" onClick={() => handleActivateRule("catchup")} disabled={loading}>
              <strong>Catch up from pause</strong>
              <span>Pull all newsletters that arrived while this rule was paused.</span>
            </button>
            <button className="activate-option" onClick={() => handleActivateRule("fresh")} disabled={loading}>
              <strong>Start fresh from now</strong>
              <span>Only sync new newsletters going forward. Skip what was missed.</span>
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

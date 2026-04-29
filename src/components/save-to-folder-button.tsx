"use client";

import { useEffect, useRef, useState } from "react";

export type FolderItem = { id: string; name: string; messageCount: number };

type Props = {
  messageId: string;
  isSaved: boolean;
  onSaved: () => void;
};

export function SaveToFolderButton({ messageId, isSaved, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus the input whenever the dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  async function markSaved() {
    await fetch(`/api/messages/${messageId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: true }),
    });
  }

  async function handleQuickSave() {
    if (isSaved || saving) return;
    setSaving(true);
    try {
      await markSaved();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenFolderPicker() {
    setOpen((prev) => !prev);
    if (open) return;
    setLoadingFolders(true);
    try {
      const res = await fetch("/api/folders");
      const data = (await res.json()) as { folders: FolderItem[] };
      setFolders(data.folders ?? []);
    } finally {
      setLoadingFolders(false);
    }
  }

  async function saveToFolder(folderId: string) {
    setSaving(true);
    try {
      await markSaved();
      await fetch(`/api/folders/${folderId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      onSaved();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function createAndSave() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; folder?: FolderItem };
      if (data.ok && data.folder) {
        setFolders((prev) => [...prev, data.folder!]);
        setNewName("");
        await saveToFolder(data.folder.id);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="save-btn-group" ref={dropdownRef}>
      {/* Primary: quick save */}
      <button
        className={`button-secondary save-btn-primary${isSaved ? " save-btn-saved" : ""}`}
        onClick={() => void handleQuickSave()}
        disabled={isSaved || saving}
        title={isSaved ? "Already saved" : "Save without folder"}
      >
        {saving && !open ? "Saving…" : isSaved ? "Saved" : "Save"}
      </button>

      {/* Secondary: save to folder (opens picker) */}
      <button
        className={`button-secondary save-btn-folder${open ? " save-btn-folder-open" : ""}`}
        onClick={() => void handleOpenFolderPicker()}
        title="Save to folder"
      >
        Save to folder
        <span className="save-btn-chevron" aria-hidden>{open ? "▲" : "▼"}</span>
      </button>

      {/* Folder picker dropdown */}
      {open && (
        <div className="folder-picker-dropdown">
          <p className="folder-picker-heading">Choose a folder</p>

          {loadingFolders ? (
            <p className="folder-picker-empty">Loading…</p>
          ) : folders.length === 0 ? (
            <p className="folder-picker-empty">No folders yet — create one below.</p>
          ) : (
            <div className="folder-picker-list">
              {folders.map((f) => (
                <button
                  key={f.id}
                  className="folder-picker-option"
                  onClick={() => void saveToFolder(f.id)}
                  disabled={saving}
                >
                  <span className="folder-picker-icon">▸</span>
                  <span className="folder-picker-name">{f.name}</span>
                  {f.messageCount > 0 && (
                    <span className="folder-picker-count">{f.messageCount}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Create new folder */}
          <div className="folder-picker-new">
            <input
              ref={inputRef}
              className="folder-picker-input"
              placeholder="New folder name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createAndSave();
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <button
              className="folder-picker-create"
              onClick={() => void createAndSave()}
              disabled={creating || !newName.trim()}
            >
              {creating ? "…" : "Create"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

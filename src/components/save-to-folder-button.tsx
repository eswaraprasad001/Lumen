"use client";

import { useEffect, useRef, useState } from "react";

export type FolderItem = { id: string; name: string; messageCount: number };

type Props = {
  messageId: string;
  isSaved: boolean;
  onSaved: () => void;
};

export function SaveToFolderButton({ messageId, isSaved, onSaved }: Props) {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close folder picker on outside click
  useEffect(() => {
    if (!folderPickerOpen) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFolderPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [folderPickerOpen]);

  useEffect(() => {
    if (folderPickerOpen) setTimeout(() => inputRef.current?.focus(), 60);
  }, [folderPickerOpen]);

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
    setFolderPickerOpen(true);
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
      setFolderPickerOpen(false);
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
    <div className="save-hover-wrap" ref={wrapRef}>
      {/* Trigger button */}
      <button
        className={`button-secondary${isSaved ? " save-btn-saved" : ""}`}
        disabled={saving}
      >
        {saving ? "Saving…" : isSaved ? "Saved" : "Save"}
      </button>

      {/* Hover dropdown — two choices */}
      {!folderPickerOpen && (
        <div className="save-hover-menu">
          <button
            className="save-hover-item"
            onClick={() => void handleQuickSave()}
            disabled={isSaved || saving}
          >
            Save
          </button>
          <button
            className="save-hover-item"
            onClick={() => void handleOpenFolderPicker()}
            disabled={saving}
          >
            Save to folder
          </button>
        </div>
      )}

      {/* Folder picker popup */}
      {folderPickerOpen && (
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

          <div className="folder-picker-new">
            <input
              ref={inputRef}
              className="folder-picker-input"
              placeholder="New folder name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createAndSave();
                if (e.key === "Escape") setFolderPickerOpen(false);
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

"use client";

import { useEffect, useRef, useState } from "react";

export type FolderItem = { id: string; name: string; messageCount: number };

type Props = {
  messageId: string;
  isSaved: boolean;
  onSaved: () => void;
};

export function SaveToFolderButton({ messageId, isSaved, onSaved }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen && !folderPickerOpen) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setFolderPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, folderPickerOpen]);

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
      setMenuOpen(false);
    }
  }

  async function openFolderPicker() {
    setMenuOpen(false);
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

  async function createFolder() {
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
        // Add to list — user then clicks the folder row to save there
        setFolders((prev) => [...prev, { ...data.folder!, messageCount: 0 }]);
        setNewName("");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="save-split-wrap" ref={wrapRef}>
      {/* Left: quick save */}
      <button
        className={`button-secondary save-split-left${isSaved ? " save-btn-saved" : ""}`}
        onClick={() => void handleQuickSave()}
        disabled={isSaved || saving}
      >
        {saving && !folderPickerOpen ? "Saving…" : isSaved ? "Saved" : "Save"}
      </button>

      {/* Right: arrow that opens dropdown */}
      <button
        className={`button-secondary save-split-right${menuOpen || folderPickerOpen ? " save-btn-saved" : ""}`}
        onClick={() => {
          if (folderPickerOpen) { setFolderPickerOpen(false); return; }
          setMenuOpen((v) => !v);
        }}
        aria-label="Save options"
      >
        ▾
      </button>

      {/* Step 1: tiny menu */}
      {menuOpen && !folderPickerOpen && (
        <div className="save-menu-dropdown">
          <button className="save-menu-item" onClick={() => void openFolderPicker()}>
            Save to folder
          </button>
        </div>
      )}

      {/* Step 2: folder picker */}
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
                if (e.key === "Enter") void createFolder();
                if (e.key === "Escape") setFolderPickerOpen(false);
              }}
            />
            <button
              className="folder-picker-create"
              onClick={() => void createFolder()}
              disabled={creating || !newName.trim()}
            >
              {creating ? "…" : "+ Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

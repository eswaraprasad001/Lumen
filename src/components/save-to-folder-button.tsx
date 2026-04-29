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
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleOpen() {
    setOpen((prev) => !prev);
    if (!open) {
      setLoading(true);
      try {
        const res = await fetch("/api/folders");
        const data = (await res.json()) as { folders: FolderItem[] };
        setFolders(data.folders ?? []);
      } finally {
        setLoading(false);
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function markSaved() {
    await fetch(`/api/messages/${messageId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: true }),
    });
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

  async function saveWithoutFolder() {
    setSaving(true);
    try {
      await markSaved();
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
    <div className="folder-picker-wrap" ref={ref}>
      <button
        className="button-secondary"
        onClick={() => void handleOpen()}
        disabled={saving}
      >
        {saving ? "Saving…" : isSaved ? "Saved ✓" : "Save to folder"}
      </button>

      {open && (
        <div className="folder-picker-dropdown">
          <button
            className="folder-picker-option folder-picker-option-soft"
            onClick={() => void saveWithoutFolder()}
          >
            Save without folder
          </button>

          {loading ? (
            <p className="folder-picker-empty">Loading folders…</p>
          ) : folders.length === 0 ? (
            <p className="folder-picker-empty">No folders yet — create one below.</p>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                className="folder-picker-option"
                onClick={() => void saveToFolder(f.id)}
              >
                <span className="folder-picker-icon">▸</span>
                {f.name}
                <span className="folder-picker-count">{f.messageCount}</span>
              </button>
            ))
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
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <button
              className="folder-picker-create"
              onClick={() => void createAndSave()}
              disabled={creating || !newName.trim()}
            >
              {creating ? "…" : "+ Create & save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

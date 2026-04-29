"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { SavedFolder } from "@/lib/types";

type Props = {
  folders: SavedFolder[];
};

export function FolderManager({ folders: initialFolders }: Props) {
  const router = useRouter();
  const [folders, setFolders] = useState(initialFolders);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function createFolder() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; folder?: SavedFolder };
      if (data.ok && data.folder) {
        setFolders((prev) => [...prev, data.folder!]);
        setNewName("");
        router.refresh();
      }
    } finally {
      setCreating(false);
    }
  }

  function startRename(folder: SavedFolder) {
    setRenamingId(folder.id);
    setRenameValue(folder.name);
    setTimeout(() => inputRef.current?.focus(), 40);
  }

  async function commitRename(id: string) {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: renameValue.trim() } : f)),
    );
    setRenamingId(null);
    router.refresh();
  }

  async function deleteFolder(id: string) {
    if (!confirm("Delete this folder? Articles in it will not be deleted.")) return;
    await fetch(`/api/folders/${id}`, { method: "DELETE" });
    setFolders((prev) => prev.filter((f) => f.id !== id));
    router.refresh();
  }

  return (
    <div className="folder-manager">
      <h3 className="folder-manager-title">Folders</h3>

      {folders.length === 0 ? (
        <p className="folder-manager-empty">No folders yet.</p>
      ) : (
        <ul className="folder-manager-list">
          {folders.map((f) => (
            <li key={f.id} className="folder-manager-item">
              {renamingId === f.id ? (
                <input
                  ref={inputRef}
                  className="folder-manager-rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(f.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => void commitRename(f.id)}
                />
              ) : (
                <>
                  <span className="folder-manager-name">{f.name}</span>
                  <span className="folder-manager-count">{f.messageCount}</span>
                  <button
                    className="folder-manager-action"
                    onClick={() => startRename(f)}
                    title="Rename"
                  >
                    ✎
                  </button>
                  <button
                    className="folder-manager-action folder-manager-delete"
                    onClick={() => void deleteFolder(f.id)}
                    title="Delete folder"
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="folder-manager-new">
        <input
          className="folder-picker-input"
          placeholder="New folder name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void createFolder()}
        />
        <button
          className="folder-picker-create"
          onClick={() => void createFolder()}
          disabled={creating || !newName.trim()}
        >
          {creating ? "…" : "+ Create"}
        </button>
      </div>
    </div>
  );
}

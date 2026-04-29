"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { SavedFolder } from "@/lib/types";

type Props = {
  folders: SavedFolder[];
};

export function FolderManager({ folders: initialFolders }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState(initialFolders);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => newNameRef.current?.focus(), 40);
  }, [open]);

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
        setFolders((prev) => [...prev, { ...data.folder!, messageCount: 0 }]);
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
    setTimeout(() => renameRef.current?.focus(), 40);
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
    <>
      <button className="button-ghost folder-mgr-trigger" onClick={() => setOpen(true)}>
        + Folder
      </button>

      {open && (
        <div className="onboarding-backdrop" onClick={() => setOpen(false)}>
          <div className="activate-modal folder-modal-inner" onClick={(e) => e.stopPropagation()}>
            <button className="onboarding-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>

            <div className="activate-modal-header">
              <h2>Folders</h2>
              <p>Organise your saved newsletters into folders.</p>
            </div>

            {folders.length > 0 && (
              <ul className="folder-manager-list">
                {folders.map((f) => (
                  <li key={f.id} className="folder-manager-item">
                    {renamingId === f.id ? (
                      <input
                        ref={renameRef}
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
                ref={newNameRef}
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
        </div>
      )}
    </>
  );
}

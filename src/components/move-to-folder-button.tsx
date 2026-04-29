"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { FolderItem } from "@/components/save-to-folder-button";

type Props = {
  messageId: string;
};

export function MoveToFolderButton({ messageId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleOpen() {
    setOpen((v) => !v);
    if (!open) {
      setLoading(true);
      try {
        const res = await fetch("/api/folders");
        const data = (await res.json()) as { folders: FolderItem[] };
        setFolders(data.folders ?? []);
      } finally {
        setLoading(false);
      }
    }
  }

  async function moveToFolder(folderId: string) {
    setMoving(folderId);
    try {
      await fetch(`/api/folders/${folderId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      setOpen(false);
      router.refresh();
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="move-folder-wrap" ref={wrapRef}>
      <button
        className="button-ghost move-folder-btn"
        onClick={() => void handleOpen()}
        title="Move to folder"
      >
        ▸ Move
      </button>

      {open && (
        <div className="folder-picker-dropdown">
          <p className="folder-picker-heading">Move to folder</p>
          {loading ? (
            <p className="folder-picker-empty">Loading…</p>
          ) : folders.length === 0 ? (
            <p className="folder-picker-empty">No folders yet. Create one from the Folders panel.</p>
          ) : (
            <div className="folder-picker-list">
              {folders.map((f) => (
                <button
                  key={f.id}
                  className="folder-picker-option"
                  onClick={() => void moveToFolder(f.id)}
                  disabled={moving === f.id}
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
        </div>
      )}
    </div>
  );
}

"use client";

import { BookOpen, Loader2 } from "lucide-react";
import type { NoteHistoryEntry } from "@/lib/types";
import { formatShortDate } from "@/lib/format";
import { Modal } from "@/components/ui/modal";

export function NoteHistoryModal({
  open,
  onClose,
  title,
  entries,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  entries: NoteHistoryEntry[];
  loading: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {loading ? (
        <div className="grid place-items-center py-12 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted">
          <BookOpen size={22} />
          <p className="text-sm">No earlier notes yet.</p>
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-border bg-surface-2 p-3">
              <time className="text-[10px] font-medium uppercase tracking-wide text-accent">
                {formatShortDate(entry.performed_on)}
              </time>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {entry.notes}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

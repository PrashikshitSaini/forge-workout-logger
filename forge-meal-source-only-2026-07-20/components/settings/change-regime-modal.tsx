"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Regime } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { switchRegime } from "@/lib/mutations";

export function ChangeRegimeModal({
  open,
  onClose,
  currentRegime,
  onSwitched,
}: {
  open: boolean;
  onClose: () => void;
  currentRegime: Regime;
  onSwitched: () => void;
}) {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [name, setName] = useState("");
  const [clone, setClone] = useState(true);
  const [busy, setBusy] = useState(false);

  async function handleSwitch() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await switchRegime(sb, name.trim(), clone ? currentRegime.id : undefined);
      toast("New regime started.", "success");
      onSwitched();
      onClose();
      setName("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't switch regime.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Change regime">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Your current regime{" "}
          <span className="text-foreground">“{currentRegime.name}”</span> and all its history will
          be archived — kept and readable, just no longer active.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="regime-name">New regime name</Label>
          <Input
            id="regime-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hypertrophy — Summer"
          />
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <input
            type="checkbox"
            checked={clone}
            onChange={(e) => setClone(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span className="text-sm">
            <span className="block font-medium">Start from a copy of my current days</span>
            <span className="block text-muted">
              Clones every day + exercise so you only edit what changed. Uncheck to start blank.
            </span>
          </span>
        </label>

        <Button className="w-full" onClick={handleSwitch} disabled={busy || !name.trim()}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : "Start new regime"}
        </Button>
      </div>
    </Modal>
  );
}

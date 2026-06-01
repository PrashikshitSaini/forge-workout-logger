"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Routine } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createRoutine, updateRoutine } from "@/lib/mutations";
import { DAYS_OF_WEEK } from "@/lib/constants";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function RoutineForm({
  open,
  onClose,
  onSaved,
  regimeId,
  position,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (routine: Routine) => void;
  regimeId: string;
  position: number;
  initial?: { id: string; name: string; day_of_week: number | null };
}) {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [name, setName] = useState(initial?.name ?? "");
  const [day, setDay] = useState<number>(initial?.day_of_week ?? 1);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (initial) {
        await updateRoutine(sb, initial.id, { name: name.trim(), day_of_week: day });
        onSaved({
          id: initial.id,
          name: name.trim(),
          day_of_week: day,
        } as Routine);
      } else {
        const routine = await createRoutine(sb, regimeId, name.trim(), day, position);
        onSaved(routine);
      }
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save routine.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit day" : "New day"}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="routine-name">Name</Label>
          <Input
            id="routine-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Back, Arms, Legs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="routine-day">Day of week</Label>
          <Select
            id="routine-day"
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
          >
            {DAY_ORDER.map((d) => (
              <option key={d} value={d}>
                {DAYS_OF_WEEK.find((x) => x.value === d)!.full}
              </option>
            ))}
          </Select>
        </div>
        <Button className="w-full" onClick={handleSave} disabled={busy || !name.trim()}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : initial ? "Save" : "Create day"}
        </Button>
      </div>
    </Modal>
  );
}

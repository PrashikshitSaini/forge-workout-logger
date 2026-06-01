"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import type { Exercise, ExerciseType } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getExercises } from "@/lib/queries";
import { findOrCreateExercise } from "@/lib/mutations";
import { EQUIPMENT, MUSCLE_GROUPS } from "@/lib/constants";

export function ExercisePicker({
  open,
  onClose,
  onPick,
  excludeIds = [],
}: {
  open: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
  excludeIds?: string[];
}) {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // New-exercise form
  const [name, setName] = useState("");
  const [muscle, setMuscle] = useState<string>(MUSCLE_GROUPS[0]);
  const [equipment, setEquipment] = useState<string>(EQUIPMENT[1]);
  const [type, setType] = useState<ExerciseType>("strength");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getExercises(sb)
      .then(setExercises)
      .catch(() => toast("Couldn't load exercises.", "error"))
      .finally(() => setLoading(false));
  }, [open, sb]);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter(
      (e) => !excluded.has(e.id) && (!q || e.name.toLowerCase().includes(q)),
    );
  }, [exercises, query, excluded]);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await findOrCreateExercise(sb, {
        name,
        muscle_group: muscle,
        equipment,
        type,
      });
      onPick(created);
      resetCreate();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't create exercise.", "error");
    } finally {
      setBusy(false);
    }
  }

  function resetCreate() {
    setName("");
    setMuscle(MUSCLE_GROUPS[0]);
    setEquipment(EQUIPMENT[1]);
    setType("strength");
    setCreating(false);
  }

  return (
    <Modal open={open} onClose={onClose} title="Add exercise">
      {creating ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ex-name">Name</Label>
            <Input
              id="ex-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Incline Dumbbell Press"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="ex-muscle">Muscle</Label>
              <Select id="ex-muscle" value={muscle} onChange={(e) => setMuscle(e.target.value)}>
                {MUSCLE_GROUPS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-equip">Equipment</Label>
              <Select id="ex-equip" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
                {EQUIPMENT.map((eq) => (
                  <option key={eq} value={eq}>
                    {eq}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {(["strength", "cardio"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={
                    "h-10 flex-1 rounded-lg border text-sm capitalize " +
                    (type === t
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border bg-surface-2 text-muted")
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={resetCreate} disabled={busy}>
              Back
            </Button>
            <Button className="flex-1" onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : "Add"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your exercises…"
              className="pl-9"
            />
          </div>

          <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>
            <Plus size={16} /> New exercise
          </Button>

          {loading ? (
            <div className="grid place-items-center py-8 text-muted">
              <Loader2 className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              {exercises.length === 0 ? "No exercises yet — create one above." : "No matches."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(e);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left hover:border-accent/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{e.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {[e.equipment, e.muscle_group].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Plus size={16} className="shrink-0 text-accent" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { MoreVertical, Plus, StickyNote } from "lucide-react";
import type { SessionExerciseFull, WorkoutSet } from "@/lib/types";
import { SetRow } from "./set-row";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { addSet, updateSessionExerciseNotes } from "@/lib/mutations";
import { WEIGHT_UNIT } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function ExerciseCard({
  index,
  sessionExercise,
  lastSummary,
  onOpenActions,
}: {
  index: number;
  sessionExercise: SessionExerciseFull;
  lastSummary?: string;
  /** Opens the replace / remove action sheet for this exercise. */
  onOpenActions: () => void;
}) {
  const sb = createSupabaseBrowserClient();
  const ex = sessionExercise.exercise;
  const isCardio = ex.type === "cardio";

  const [sets, setSets] = useState<WorkoutSet[]>(sessionExercise.sets);
  const [notes, setNotes] = useState(sessionExercise.notes ?? "");
  const [showNotes, setShowNotes] = useState(Boolean(sessionExercise.notes));
  const [adding, setAdding] = useState(false);

  async function handleAddSet() {
    setAdding(true);
    const last = sets[sets.length - 1];
    const nextNumber = (last?.set_number ?? 0) + 1;
    const seed = isCardio
      ? { duration_seconds: last?.duration_seconds ?? null, level: last?.level ?? null }
      : { weight: last?.weight ?? null, reps: last?.reps ?? null };
    try {
      const created = await addSet(sb, sessionExercise.id, nextNumber, seed);
      setSets((prev) => [...prev, created]);
    } catch {
      toast("Couldn't add a set.", "error");
    } finally {
      setAdding(false);
    }
  }

  function handleDeleted(id: string) {
    setSets((prev) => prev.filter((s) => s.id !== id));
  }

  async function saveNotes() {
    try {
      await updateSessionExerciseNotes(sb, sessionExercise.id, notes);
    } catch {
      toast("Couldn't save the note.", "error");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">
            <span className="text-muted-foreground">{index}.</span> {ex.name}
          </h3>
          <p className="truncate text-xs text-muted">
            {[ex.equipment, ex.muscle_group].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            aria-label="Toggle notes"
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg",
              showNotes || notes ? "text-accent" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <StickyNote size={16} />
          </button>
          <button
            type="button"
            onClick={onOpenActions}
            aria-label="Replace or remove exercise"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-2"
          >
            <MoreVertical size={16} />
          </button>
        </div>
      </header>

      {lastSummary ? (
        <p className="tabular px-3 pt-1 text-xs text-muted-foreground">last → {lastSummary}</p>
      ) : null}

      <div className="px-3 pb-1 pt-2">
        <div className="flex items-center gap-2 px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="w-9" />
          <span className="flex-1 text-center">{isCardio ? "min" : WEIGHT_UNIT}</span>
          <span className="flex-1 text-center">{isCardio ? "level" : "reps"}</span>
          <span className="w-8" />
        </div>
        {sets.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">No sets — add one below.</p>
        ) : (
          sets.map((s) => (
            <SetRow key={s.id} set={s} type={ex.type} onDeleted={handleDeleted} />
          ))
        )}
      </div>

      {showNotes ? (
        <div className="px-3 pb-3">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={2}
            placeholder="Notes — form cues, pain, tempo…"
          />
        </div>
      ) : null}

      <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={handleAddSet}
          disabled={adding}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
        >
          <Plus size={16} /> Add set
        </button>
      </div>
    </section>
  );
}

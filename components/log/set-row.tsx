"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import type { ExerciseType, WorkoutSet } from "@/lib/types";
import { Stepper } from "@/components/ui/stepper";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { deleteSet, updateSet, type SetPatch } from "@/lib/mutations";
import { WEIGHT_UNIT } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** One editable set. Optimistic local state; writes are debounced and retried. */
export function SetRow({
  set,
  type,
  onDeleted,
}: {
  set: WorkoutSet;
  type: ExerciseType;
  onDeleted: (id: string) => void;
}) {
  const sb = createSupabaseBrowserClient();

  const [weight, setWeight] = useState(set.weight);
  const [reps, setReps] = useState(set.reps);
  const [durationMin, setDurationMin] = useState<number | null>(
    set.duration_seconds != null ? Math.round(set.duration_seconds / 60) : null,
  );
  const [level, setLevel] = useState(set.level);
  const [done, setDone] = useState(set.done);
  const [deleting, setDeleting] = useState(false);

  const pending = useRef<SetPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    try {
      await updateSet(sb, set.id, patch);
    } catch {
      // Keep the change locally and re-queue it so the next edit retries.
      pending.current = { ...patch, ...pending.current };
      toast("Couldn't save — kept locally, will retry.", "error");
    }
  }, [sb, set.id]);

  const schedule = useCallback(
    (patch: SetPatch) => {
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  // Flush any pending edit when the row unmounts (e.g. on Finish / navigation).
  useEffect(() => () => void flush(), [flush]);

  const toggleDone = () => {
    const next = !done;
    setDone(next);
    pending.current = { ...pending.current, done: next };
    void flush();
  };

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteSet(sb, set.id);
      onDeleted(set.id);
    } catch {
      toast("Couldn't delete that set.", "error");
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <button
        type="button"
        onClick={toggleDone}
        aria-pressed={done}
        aria-label={done ? "Mark set not done" : "Mark set done"}
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition",
          done
            ? "border-accent bg-accent text-accent-foreground"
            : "border-border bg-surface-2 text-muted hover:text-foreground",
        )}
      >
        <Check size={18} />
      </button>

      {type === "strength" ? (
        <>
          <Stepper
            ariaLabel="weight"
            value={weight}
            onChange={(v) => {
              setWeight(v);
              schedule({ weight: v });
            }}
            step={5}
            decimals
            suffix={WEIGHT_UNIT}
            className="flex-1"
          />
          <Stepper
            ariaLabel="reps"
            value={reps}
            onChange={(v) => {
              setReps(v);
              schedule({ reps: v });
            }}
            step={1}
            suffix="reps"
            className="flex-1"
          />
        </>
      ) : (
        <>
          <Stepper
            ariaLabel="minutes"
            value={durationMin}
            onChange={(v) => {
              setDurationMin(v);
              schedule({ duration_seconds: v != null ? v * 60 : null });
            }}
            step={1}
            suffix="min"
            className="flex-1"
          />
          <Stepper
            ariaLabel="level"
            value={level}
            onChange={(v) => {
              setLevel(v);
              schedule({ level: v });
            }}
            step={1}
            suffix="lvl"
            className="flex-1"
          />
        </>
      )}

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label="Delete set"
        className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-danger disabled:opacity-40"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

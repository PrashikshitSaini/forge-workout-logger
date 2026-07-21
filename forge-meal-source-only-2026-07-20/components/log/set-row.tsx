"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import type { ExerciseType, WorkoutSet } from "@/lib/types";
import { Stepper } from "@/components/ui/stepper";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { deleteSet, updateSet, type SetPatch } from "@/lib/mutations";
import { cn } from "@/lib/utils";

export type RegisterSetFlush = (
  setId: string,
  flush: () => Promise<boolean>,
) => () => void;

/** One editable set. Optimistic local state; writes are debounced and retried. */
export function SetRow({
  set,
  type,
  onDeleted,
  registerFlush,
}: {
  set: WorkoutSet;
  type: ExerciseType;
  onDeleted: (id: string) => void;
  registerFlush?: RegisterSetFlush;
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
  const inFlight = useRef<Promise<boolean> | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // If the debounce already started a request, wait for it before deciding
    // there is nothing left to save. This makes Finish Workout a real barrier.
    if (inFlight.current) await inFlight.current;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return true;
    const request = (async () => {
      try {
        await updateSet(sb, set.id, patch);
        return true;
      } catch {
        // Keep the change locally and re-queue it so the next edit retries.
        pending.current = { ...patch, ...pending.current };
        toast("Couldn't save — kept locally, will retry.", "error");
        return false;
      }
    })();
    inFlight.current = request;
    const saved = await request;
    if (inFlight.current === request) inFlight.current = null;
    return saved;
  }, [sb, set.id]);

  const schedule = useCallback(
    (patch: SetPatch) => {
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 600);
    },
    [flush],
  );

  // The parent registers every row as a save barrier before finishing. We also
  // flush on unmount so navigation never knowingly abandons a pending edit.
  useEffect(() => {
    const unregister = registerFlush?.(set.id, flush);
    return () => {
      unregister?.();
      void flush();
    };
  }, [flush, registerFlush, set.id]);

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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import type { ExerciseType, WorkoutSet } from "@/lib/types";
import { Stepper } from "@/components/ui/stepper";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { deleteSet, type SetPatch } from "@/lib/mutations";
import { cn } from "@/lib/utils";
import {
  flushPendingSet,
  getPendingSetPatch,
  queueSetPatch,
} from "@/lib/workout-pending";

export type RegisterSetFlush = (
  setId: string,
  flush: () => Promise<boolean>,
) => () => void;

/** One editable set. Optimistic local state; writes are debounced and retried. */
export function SetRow({
  set,
  type,
  sessionId,
  onDeleted,
  registerFlush,
}: {
  set: WorkoutSet;
  type: ExerciseType;
  sessionId: string;
  onDeleted: (id: string) => void;
  registerFlush?: RegisterSetFlush;
}) {
  const sb = createSupabaseBrowserClient();

  const recovered = getPendingSetPatch(set.id);
  const [weight, setWeight] = useState(recovered?.weight ?? set.weight);
  const [reps, setReps] = useState(recovered?.reps ?? set.reps);
  const [durationMin, setDurationMin] = useState<number | null>(
    recovered?.duration_seconds != null
      ? Math.round(recovered.duration_seconds / 60)
      : set.duration_seconds != null
        ? Math.round(set.duration_seconds / 60)
        : null,
  );
  const [level, setLevel] = useState(recovered?.level ?? set.level);
  const [done, setDone] = useState(recovered?.done ?? set.done);
  const [deleting, setDeleting] = useState(false);

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
    const request = (async () => {
      const saved = await flushPendingSet(sb, set.id);
      if (!saved) toast("Couldn't save — kept on this device and will retry.", "error");
      return saved;
    })();
    inFlight.current = request;
    const saved = await request;
    if (inFlight.current === request) inFlight.current = null;
    return saved;
  }, [sb, set.id]);

  const schedule = useCallback(
    (patch: SetPatch) => {
      queueSetPatch(sessionId, set.id, patch);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 600);
    },
    [flush, sessionId, set.id],
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
    queueSetPatch(sessionId, set.id, { done: next });
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
    <div className="flex items-start gap-2 py-1">
      <button
        type="button"
        onClick={toggleDone}
        aria-pressed={done}
        aria-label={done ? "Mark set not done" : "Mark set done"}
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-lg border transition",
          done
            ? "border-accent bg-accent text-accent-foreground"
            : "border-border bg-surface-2 text-muted hover:text-foreground",
        )}
      >
        <Check size={18} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2 min-[480px]:flex-row">
        {type === "strength" ? (
          <>
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground min-[480px]:hidden">Weight</span>
              <Stepper
                ariaLabel="weight"
                value={weight}
                onChange={(v) => {
                  setWeight(v);
                  schedule({ weight: v });
                }}
                step={5}
                decimals
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground min-[480px]:hidden">Reps</span>
              <Stepper
                ariaLabel="reps"
                value={reps}
                onChange={(v) => {
                  setReps(v);
                  schedule({ reps: v });
                }}
                step={1}
              />
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground min-[480px]:hidden">Minutes</span>
              <Stepper
                ariaLabel="minutes"
                value={durationMin}
                onChange={(v) => {
                  setDurationMin(v);
                  schedule({ duration_seconds: v != null ? v * 60 : null });
                }}
                step={1}
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground min-[480px]:hidden">Level</span>
              <Stepper
                ariaLabel="level"
                value={level}
                onChange={(v) => {
                  setLevel(v);
                  schedule({ level: v });
                }}
                step={1}
              />
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label="Delete set"
        className="grid h-11 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-danger disabled:opacity-40"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

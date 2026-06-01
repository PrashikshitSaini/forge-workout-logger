"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Exercise, RoutineExercise, RoutineWithExercises } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ExercisePicker } from "./exercise-picker";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { addRoutineExercise, removeRoutineExercise, updateRoutineExercise } from "@/lib/mutations";
import { dayLabel } from "@/lib/constants";

type Item = RoutineExercise & { exercise: Exercise };

export function RoutineEditor({
  routine,
  onEdit,
  onDelete,
}: {
  routine: RoutineWithExercises;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [items, setItems] = useState<Item[]>(routine.routine_exercises);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function handlePick(exercise: Exercise) {
    if (items.some((it) => it.exercise_id === exercise.id)) {
      toast("Already in this routine.", "info");
      return;
    }
    try {
      const re = await addRoutineExercise(sb, routine.id, exercise.id, items.length, 3, null);
      setItems((prev) => [...prev, { ...re, exercise }]);
    } catch {
      toast("Couldn't add exercise.", "error");
    }
  }

  async function handleRemove(id: string) {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      await removeRoutineExercise(sb, id);
    } catch {
      setItems(prev);
      toast("Couldn't remove exercise.", "error");
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const swapped = [...items];
    [swapped[index], swapped[j]] = [swapped[j], swapped[index]];
    // Fresh objects so we never mutate current React state in place.
    const reindexed = swapped.map((it, idx) => ({ ...it, position: idx }));
    setItems(reindexed);
    try {
      await Promise.all([
        updateRoutineExercise(sb, reindexed[index].id, { position: index }),
        updateRoutineExercise(sb, reindexed[j].id, { position: j }),
      ]);
    } catch {
      toast("Couldn't reorder.", "error");
    }
  }

  async function saveTarget(id: string, patch: { target_sets?: number | null; target_reps?: string | null }) {
    try {
      await updateRoutineExercise(sb, id, patch);
    } catch {
      toast("Couldn't save target.", "error");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{routine.name}</h3>
          <p className="text-xs text-muted">{dayLabel(routine.day_of_week)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit day"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-foreground hover:bg-surface-2"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete day"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-danger hover:bg-surface-2"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <ul className="divide-y divide-border">
        {items.map((it, i) => (
          <li key={it.id} className="flex items-center gap-2 px-3 py-2">
            <GripVertical size={14} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{it.exercise.name}</p>
              <p className="truncate text-xs text-muted">
                {[it.exercise.equipment, it.exercise.muscle_group].filter(Boolean).join(" · ")}
              </p>
            </div>
            {it.exercise.type === "strength" ? (
              <div className="flex shrink-0 items-center gap-1">
                <Input
                  aria-label="target sets"
                  inputMode="numeric"
                  defaultValue={it.target_sets ?? ""}
                  onBlur={(e) =>
                    saveTarget(it.id, {
                      target_sets: e.target.value ? parseInt(e.target.value, 10) : null,
                    })
                  }
                  className="tabular h-8 w-10 px-1 text-center text-sm"
                  placeholder="3"
                />
                <span className="text-xs text-muted-foreground">×</span>
                <Input
                  aria-label="target reps"
                  defaultValue={it.target_reps ?? ""}
                  onBlur={(e) => saveTarget(it.id, { target_reps: e.target.value || null })}
                  className="tabular h-8 w-14 px-1 text-center text-sm"
                  placeholder="8-10"
                />
              </div>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">cardio</span>
            )}
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                aria-label="Move down"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown size={16} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleRemove(it.id)}
              aria-label="Remove exercise"
              className="grid h-8 w-7 shrink-0 place-items-center text-muted-foreground hover:text-danger"
            >
              <X size={15} />
            </button>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">No exercises yet.</li>
        ) : null}
      </ul>

      <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <Plus size={16} /> Add exercise
        </button>
      </div>

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
        excludeIds={items.map((it) => it.exercise_id)}
      />
    </section>
  );
}

"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder } from "framer-motion";
import {
  ArrowUpDown,
  History,
  Check,
  CheckCircle2,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { Exercise, NoteHistoryEntry, SessionExerciseFull, SessionFull } from "@/lib/types";
import { ExerciseCard } from "./exercise-card";
import { ExercisePicker } from "@/components/routines/exercise-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  addSessionExerciseAndRoutine,
  finishSession,
  removeSessionExerciseAndRoutine,
  reorderSessionExercisesAndRoutine,
  swapSessionExerciseAndRoutine,
  updateSessionNotes,
} from "@/lib/mutations";
import { summarizeSets } from "@/lib/set-summary";
import { DATA_CHANGED_EVENT } from "@/lib/events";
import { getWorkoutNoteHistory } from "@/lib/queries";
import { NoteHistoryModal } from "./note-history-modal";
import type { RegisterSetFlush } from "./set-row";

type PickerMode = "add" | "swap";

export function SessionLogger({
  session,
  lastSession,
}: {
  session: SessionFull;
  lastSession: SessionFull | null;
}) {
  const sb = createSupabaseBrowserClient();
  const [exercises, setExercises] = useState<SessionExerciseFull[]>(session.session_exercises);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>("add");
  const [swapTarget, setSwapTarget] = useState<SessionExerciseFull | null>(null);
  const [actionTarget, setActionTarget] = useState<SessionExerciseFull | null>(null);
  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<SessionExerciseFull[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(Boolean(session.finished_at));
  const [notes, setNotes] = useState(session.notes ?? "");
  const [noteHistoryOpen, setNoteHistoryOpen] = useState(false);
  const [noteHistoryLoading, setNoteHistoryLoading] = useState(false);
  const [noteHistory, setNoteHistory] = useState<NoteHistoryEntry[]>([]);
  const setFlushers = useRef(new Map<string, () => Promise<boolean>>());

  const registerSetFlush: RegisterSetFlush = useCallback((setId, flush) => {
    setFlushers.current.set(setId, flush);
    return () => setFlushers.current.delete(setId);
  }, []);

  const lastByExercise = new Map<string, SessionExerciseFull>();
  for (const se of lastSession?.session_exercises ?? []) {
    if (!lastByExercise.has(se.exercise_id)) lastByExercise.set(se.exercise_id, se);
  }

  function openAddPicker() {
    setPickerMode("add");
    setSwapTarget(null);
    setPickerOpen(true);
  }

  function openSwapPicker(target: SessionExerciseFull) {
    setActionTarget(null);
    setPickerMode("swap");
    setSwapTarget(target);
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
    setPickerMode("add");
    setSwapTarget(null);
  }

  async function handleAddExercise(exercise: Exercise) {
    if (exercises.some((se) => se.exercise_id === exercise.id)) {
      toast("Already in this workout.", "info");
      return;
    }
    const position = exercises.length;
    const setCount = exercise.type === "cardio" ? 1 : 3;
    try {
      const created = await addSessionExerciseAndRoutine(
        sb,
        session.id,
        exercise.id,
        position,
        setCount,
      );
      setExercises((prev) => [...prev, created]);
    } catch {
      toast("Couldn't add the exercise.", "error");
    }
  }

  // Replace one exercise with another, keeping the sets already logged for it.
  // Mirrors the change to the day's routine so next week starts from the swap.
  async function handleSwap(target: SessionExerciseFull, exercise: Exercise) {
    if (exercise.id === target.exercise_id) return;
    if (exercises.some((se) => se.id !== target.id && se.exercise_id === exercise.id)) {
      toast("Already in this workout.", "info");
      return;
    }
    const prev = exercises;
    setExercises((list) =>
      list.map((se) =>
        se.id === target.id ? { ...se, exercise_id: exercise.id, exercise } : se,
      ),
    );
    try {
      await swapSessionExerciseAndRoutine(sb, target.id, exercise.id);
    } catch {
      setExercises(prev);
      toast("Couldn't replace the exercise.", "error");
      return;
    }
  }

  async function handleRemove(target: SessionExerciseFull) {
    if (!window.confirm(`Remove ${target.exercise.name} from this day? Logged history is kept.`)) {
      return;
    }
    setActionTarget(null);
    const prev = exercises;
    setExercises((list) => list.filter((se) => se.id !== target.id));
    try {
      await removeSessionExerciseAndRoutine(sb, target.id);
    } catch {
      setExercises(prev);
      toast("Couldn't remove the exercise.", "error");
      return;
    }
  }

  function enterReorder() {
    setOrder(exercises);
    setReordering(true);
  }

  function cancelReorder() {
    setReordering(false);
  }

  async function saveReorder() {
    setSavingOrder(true);
    const ordered = order;
    try {
      await reorderSessionExercisesAndRoutine(sb, ordered.map((se) => se.id));
    } catch {
      toast("Couldn't save the new order.", "error");
      setSavingOrder(false);
      return;
    }
    setExercises(ordered.map((se, i) => ({ ...se, position: i })));
    setReordering(false);
    setSavingOrder(false);
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      const saved = await Promise.all([...setFlushers.current.values()].map((flush) => flush()));
      if (saved.some((ok) => !ok)) {
        toast("Some set changes still aren't saved. Check your connection and try again.", "error");
        return;
      }
      await finishSession(sb, session.id);
      setFinished(true);
      toast("Workout saved.", "success");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
      }
    } catch {
      toast("Couldn't finish — your sets are still saved.", "error");
    } finally {
      setFinishing(false);
    }
  }

  async function saveNotes() {
    try {
      await updateSessionNotes(sb, session.id, notes);
    } catch {
      toast("Couldn't save the note.", "error");
    }
  }

  async function openWorkoutNoteHistory() {
    if (!session.routine_id) return;
    setNoteHistoryOpen(true);
    setNoteHistoryLoading(true);
    try {
      setNoteHistory(await getWorkoutNoteHistory(sb, session.routine_id, session.id));
    } catch {
      toast("Couldn't load previous workout notes.", "error");
    } finally {
      setNoteHistoryLoading(false);
    }
  }

  return (
    <div className="space-y-3 px-4">
      {exercises.length > 1 ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{exercises.length} exercises</span>
          {reordering ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={cancelReorder} disabled={savingOrder}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveReorder} disabled={savingOrder}>
                {savingOrder ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    <Check size={16} /> Done
                  </>
                )}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={enterReorder}>
              <ArrowUpDown size={16} /> Reorder
            </Button>
          )}
        </div>
      ) : null}

      {reordering ? (
        <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-2">
          {order.map((se, i) => (
            <Reorder.Item
              key={se.id}
              value={se}
              className="flex touch-none items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3.5"
              whileDrag={{ scale: 1.02, boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}
            >
              <GripVertical size={18} className="shrink-0 text-muted-foreground" />
              <span className="tabular w-5 shrink-0 text-sm text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{se.exercise.name}</span>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      ) : (
        <AnimatePresence initial={false}>
          {exercises.map((se, i) => {
            const last = lastByExercise.get(se.exercise_id);
            const lastSummary = last ? summarizeSets(last.sets, se.exercise.type) : undefined;
            return (
              <motion.div
                key={se.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18 }}
              >
                <ExerciseCard
                  index={i + 1}
                  sessionExercise={se}
                  lastSummary={lastSummary}
                  onOpenActions={() => setActionTarget(se)}
                  registerSetFlush={registerSetFlush}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}

      {exercises.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          No exercises yet — add your first one below.
        </p>
      ) : null}

      {reordering ? null : (
        <>
          <Button variant="secondary" className="w-full" onClick={openAddPicker}>
            <Plus size={18} /> Add exercise
          </Button>

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={2}
            placeholder="Session notes…"
          />
          {session.routine_id ? (
            <button
              type="button"
              onClick={() => void openWorkoutNoteHistory()}
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-accent hover:underline"
            >
              <History size={14} /> Previous workout notes
            </button>
          ) : null}

          <div className="sticky bottom-24 pb-2">
            <Button
              size="lg"
              variant={finished ? "secondary" : "primary"}
              className="w-full"
              onClick={handleFinish}
              disabled={finishing || exercises.length === 0}
            >
              {finishing ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Saving…
                </>
              ) : finished ? (
                <>
                  <CheckCircle2 size={18} className="text-accent" /> Workout saved · tap to update
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} /> Finish workout
                </>
              )}
            </Button>
          </div>
        </>
      )}

      <ExercisePicker
        open={pickerOpen}
        onClose={closePicker}
        onPick={(exercise) => {
          if (pickerMode === "swap" && swapTarget) void handleSwap(swapTarget, exercise);
          else void handleAddExercise(exercise);
        }}
        excludeIds={exercises.map((se) => se.exercise_id)}
      />

      <Modal
        open={Boolean(actionTarget)}
        onClose={() => setActionTarget(null)}
        title={actionTarget?.exercise.name}
      >
        {actionTarget ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => openSwapPicker(actionTarget)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-3 text-left hover:border-accent/50"
            >
              <RefreshCw size={18} className="shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block font-medium">Replace exercise</span>
                <span className="block text-xs text-muted">
                  Swap for another — your logged sets are kept, and next week updates too.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleRemove(actionTarget)}
              className="flex w-full items-center gap-3 rounded-lg border border-danger/40 px-3 py-3 text-left text-danger hover:bg-danger/10"
            >
              <Trash2 size={18} className="shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium">Remove exercise</span>
                <span className="block text-xs text-danger/70">
                  Takes it off this day, now and next week. History is kept.
                </span>
              </span>
            </button>
          </div>
        ) : null}
      </Modal>

      <NoteHistoryModal
        open={noteHistoryOpen}
        onClose={() => setNoteHistoryOpen(false)}
        title="Previous workout notes"
        entries={noteHistory}
        loading={noteHistoryLoading}
      />
    </div>
  );
}

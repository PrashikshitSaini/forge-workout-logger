"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import type { Exercise, SessionExerciseFull, SessionFull } from "@/lib/types";
import { ExerciseCard } from "./exercise-card";
import { ExercisePicker } from "@/components/routines/exercise-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  addSessionExercise,
  ensureRoutineExercise,
  finishSession,
  updateSessionNotes,
} from "@/lib/mutations";
import { summarizeSets } from "@/lib/set-summary";
import { DATA_CHANGED_EVENT } from "@/lib/events";

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
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(Boolean(session.finished_at));
  const [notes, setNotes] = useState(session.notes ?? "");

  const lastByExercise = new Map<string, SessionExerciseFull>();
  for (const se of lastSession?.session_exercises ?? []) {
    if (!lastByExercise.has(se.exercise_id)) lastByExercise.set(se.exercise_id, se);
  }

  async function handleAddExercise(exercise: Exercise) {
    if (exercises.some((se) => se.exercise_id === exercise.id)) {
      toast("Already in this workout.", "info");
      return;
    }
    const position = exercises.length;
    const setCount = exercise.type === "cardio" ? 1 : 3;
    try {
      // Save it to this day's routine so it's pre-filled next time…
      if (session.routine_id) {
        await ensureRoutineExercise(sb, session.routine_id, exercise.id, position, setCount);
      }
      // …and add it to the workout in progress right now.
      const { sessionExercise, sets } = await addSessionExercise(
        sb,
        session.id,
        exercise.id,
        position,
        setCount,
      );
      setExercises((prev) => [...prev, { ...sessionExercise, exercise, sets }]);
    } catch {
      toast("Couldn't add the exercise.", "error");
    }
  }

  async function handleFinish() {
    setFinishing(true);
    try {
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

  return (
    <div className="space-y-3 px-4">
      {exercises.map((se, i) => {
        const last = lastByExercise.get(se.exercise_id);
        const lastSummary = last ? summarizeSets(last.sets, se.exercise.type) : undefined;
        return (
          <ExerciseCard key={se.id} index={i + 1} sessionExercise={se} lastSummary={lastSummary} />
        );
      })}

      {exercises.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          No exercises yet — add your first one below.
        </p>
      ) : null}

      <Button variant="secondary" className="w-full" onClick={() => setPickerOpen(true)}>
        <Plus size={18} /> Add exercise
      </Button>

      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={saveNotes}
        rows={2}
        placeholder="Session notes…"
      />

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

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handleAddExercise}
        excludeIds={exercises.map((se) => se.exercise_id)}
      />
    </div>
  );
}

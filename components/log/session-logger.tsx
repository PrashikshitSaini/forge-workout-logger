"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { SessionExerciseFull, SessionFull } from "@/lib/types";
import { ExerciseCard } from "./exercise-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { finishSession, updateSessionNotes } from "@/lib/mutations";
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
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(Boolean(session.finished_at));
  const [notes, setNotes] = useState(session.notes ?? "");

  const lastByExercise = new Map<string, SessionExerciseFull>();
  for (const se of lastSession?.session_exercises ?? []) {
    if (!lastByExercise.has(se.exercise_id)) lastByExercise.set(se.exercise_id, se);
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      await finishSession(sb, session.id);
      setFinished(true);
      toast("Workout saved.", "success");
      // Let the AI coach recompute its insight against fresh data.
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
      {session.session_exercises.map((se, i) => {
        const last = lastByExercise.get(se.exercise_id);
        const lastSummary = last ? summarizeSets(last.sets, se.exercise.type) : undefined;
        return (
          <ExerciseCard
            key={se.id}
            index={i + 1}
            sessionExercise={se}
            lastSummary={lastSummary}
          />
        );
      })}

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
          disabled={finishing}
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
    </div>
  );
}

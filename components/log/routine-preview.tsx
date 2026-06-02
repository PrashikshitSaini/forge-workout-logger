"use client";

import { Loader2, Play } from "lucide-react";
import type { RoutineWithExercises, SessionFull, SessionExerciseFull } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { summarizeSets } from "@/lib/set-summary";
import { formatRelativeDate } from "@/lib/format";

export function RoutinePreview({
  routine,
  lastSession,
  starting,
  onStart,
}: {
  routine: RoutineWithExercises;
  lastSession: SessionFull | null;
  starting: boolean;
  onStart: () => void;
}) {
  const lastByExercise = new Map<string, SessionExerciseFull>();
  for (const se of lastSession?.session_exercises ?? []) {
    if (!lastByExercise.has(se.exercise_id)) lastByExercise.set(se.exercise_id, se);
  }

  if (routine.routine_exercises.length === 0) {
    return (
      <div className="px-4">
        <p className="pb-4 pt-2 text-center text-sm text-muted">
          No exercises in this day yet — start the workout and add them as you go.
        </p>
        <div className="sticky bottom-24 pb-2">
          <Button size="lg" className="w-full" onClick={onStart} disabled={starting}>
            {starting ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Starting…
              </>
            ) : (
              <>
                <Play size={18} /> Start workout
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4">
      {lastSession ? (
        <p className="pb-3 text-xs text-muted">
          Last done {formatRelativeDate(lastSession.performed_on)} · numbers below are pre-filled from
          then.
        </p>
      ) : (
        <p className="pb-3 text-xs text-muted">First time logging this routine.</p>
      )}

      <ol className="space-y-2">
        {routine.routine_exercises.map((re, i) => {
          const last = lastByExercise.get(re.exercise_id);
          const summary = last ? summarizeSets(last.sets, re.exercise.type) : "";
          return (
            <li
              key={re.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3"
            >
              <span className="tabular w-5 text-center text-sm text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{re.exercise.name}</p>
                <p className="truncate text-xs text-muted">
                  {[re.exercise.equipment, re.exercise.muscle_group].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="tabular shrink-0 text-right text-xs text-muted">
                {summary || (re.target_reps ? `${re.target_sets ?? "·"}×${re.target_reps}` : "—")}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-24 mt-5 pb-2">
        <Button size="lg" className="w-full" onClick={onStart} disabled={starting}>
          {starting ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Starting…
            </>
          ) : (
            <>
              <Play size={18} /> Start workout
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

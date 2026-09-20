"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { addRoutineExercise, createInitialRegime, createRoutine, findOrCreateExercise, switchRegime, updateRegime } from "@/lib/mutations";
import { getActiveRegime, getRoutinesWithExercises } from "@/lib/queries";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseWorkoutTemplate, type ImportedWorkoutTemplate, type ImportedWorkoutTemplateV2 } from "@/lib/workout-template-import";

export function WorkoutTemplateImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState<(ImportedWorkoutTemplate | ImportedWorkoutTemplateV2) | null>(null);
  const [importing, setImporting] = useState(false);

  function isV2Template(value: ImportedWorkoutTemplate | ImportedWorkoutTemplateV2): value is ImportedWorkoutTemplateV2 {
    return "format" in value;
  }

  async function selectFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast("That file is too large to be a workout template.", "error");
      return;
    }
    try {
      setTemplate(parseWorkoutTemplate(JSON.parse(await file.text())));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't read that template.", "error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function importTemplate() {
    if (!template) return;
    const daysToImport = template.days.filter(({ exercises }) => exercises.length > 0);
    const v2Template = isV2Template(template) ? template : null;
    if (daysToImport.length === 0) {
      toast("This template has no exercises to import.", "error");
      return;
    }

    setImporting(true);
    try {
      const sb = createSupabaseBrowserClient();
      let regime;
      if (v2Template) {
        regime = await switchRegime(sb, v2Template.name);
        if (v2Template.notes !== null) await updateRegime(sb, regime.id, { notes: v2Template.notes });
      } else {
        regime = await getActiveRegime(sb);
        if (!regime) regime = await createInitialRegime(sb, "Imported workout template");
      }
      const routines = await getRoutinesWithExercises(sb, regime.id);

      for (const [dayIndex, day] of daysToImport.entries()) {
        const v2Day = v2Template ? (day as ImportedWorkoutTemplateV2["days"][number]) : null;
        const exercises = v2Day?.exercises ?? day.exercises;
        const routine = await createRoutine(
          sb,
          regime.id,
          v2Day?.routine ?? `Shared ${day.label}`,
          day.day,
          routines.length + dayIndex,
        );
        for (const [position, value] of exercises.entries()) {
          if (typeof value === "string") {
            const exercise = await findOrCreateExercise(sb, { name: value });
            await addRoutineExercise(sb, routine.id, exercise.id, position);
          } else {
            const exercise = await findOrCreateExercise(sb, value);
            await addRoutineExercise(sb, routine.id, exercise.id, position, value.target_sets, value.target_reps);
          }
        }
      }

      setTemplate(null);
      toast(`Imported ${daysToImport.length} shared ${daysToImport.length === 1 ? "routine" : "routines"}.`, "success");
    } catch {
      toast("Couldn't import that workout template.", "error");
    } finally {
      setImporting(false);
    }
  }

  const exerciseCount = template?.days.reduce((total, day) => total + day.exercises.length, 0) ?? 0;
  const importedRoutineCount = template?.days.filter(({ exercises }) => exercises.length > 0).length ?? 0;
  const v2 = template && isV2Template(template) ? template : null;

  return (
    <section className="space-y-2">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex gap-3">
          <FileUp size={18} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <p className="font-medium">Import a shared workout</p>
            <p className="mt-1 text-xs leading-5 text-muted">Choose a Forge workout template your friend sent you. You&apos;ll preview it before it is added to your own routines.</p>
          </div>
        </div>
        <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void selectFile(event.target.files?.[0])} />
        <Button className="mt-3 w-full" variant="secondary" onClick={() => inputRef.current?.click()}>
          <FileUp size={16} /> Import workout file
        </Button>
      </div>

      <Modal
        open={template !== null}
        onClose={() => !importing && setTemplate(null)}
        title="Import shared workout"
        footer={
          <Button className="w-full" onClick={() => void importTemplate()} disabled={importing || importedRoutineCount === 0}>
            {importing ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
            Import {importedRoutineCount} {importedRoutineCount === 1 ? "routine" : "routines"}
          </Button>
        }
      >
        {template ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted">
              {v2 ? <><strong className="text-foreground">{v2.name}</strong> will start a new regime with {exerciseCount} exercises. Your existing routines and workouts will be archived, not changed.</> : <>{exerciseCount} exercises will be added as new shared routines. Your existing routines and workouts will not be changed.</>}
            </p>
            {v2?.notes ? <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5 text-muted">Notes: {v2.notes}</p> : null}
            {template.days.map((day) => (
              <section key={day.day} className="overflow-hidden rounded-xl border border-border bg-surface-2">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h3 className="font-medium">{day.label}{v2 ? ` · ${(day as ImportedWorkoutTemplateV2["days"][number]).routine}` : ""}</h3>
                  <span className="text-xs text-muted">{day.exercises.length} exercises</span>
                </div>
                {day.exercises.length > 0 ? (
                  <ol className="divide-y divide-border">
                    {day.exercises.map((value, index) => {
                      return <li key={`${typeof value === "string" ? value : value.name}-${index}`} className="px-3 py-2 text-sm"><span className="mr-3 text-xs text-muted">{index + 1}</span>{typeof value === "string" ? value : <><span>{value.name}</span><span className="ml-2 text-xs text-muted">{value.type === "cardio" ? value.target_reps : [value.target_sets && `${value.target_sets}×`, value.target_reps].filter(Boolean).join("")}</span></>}</li>;
                    })}
                  </ol>
                ) : <p className="px-3 py-3 text-sm text-muted">No exercises for this day — it will not create a routine.</p>}
              </section>
            ))}
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

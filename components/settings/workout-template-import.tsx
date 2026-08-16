"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { addRoutineExercise, createInitialRegime, createRoutine, findOrCreateExercise } from "@/lib/mutations";
import { getActiveRegime, getRoutinesWithExercises } from "@/lib/queries";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseWorkoutTemplate, type ImportedWorkoutTemplate } from "@/lib/workout-template-import";

export function WorkoutTemplateImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState<ImportedWorkoutTemplate | null>(null);
  const [importing, setImporting] = useState(false);

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
    if (daysToImport.length === 0) {
      toast("This template has no exercises to import.", "error");
      return;
    }

    setImporting(true);
    try {
      const sb = createSupabaseBrowserClient();
      let regime = await getActiveRegime(sb);
      if (!regime) regime = await createInitialRegime(sb, "Imported workout template");
      const routines = await getRoutinesWithExercises(sb, regime.id);

      for (const [dayIndex, day] of daysToImport.entries()) {
        const routine = await createRoutine(
          sb,
          regime.id,
          `Shared ${day.label}`,
          day.day,
          routines.length + dayIndex,
        );
        for (const [position, name] of day.exercises.entries()) {
          const exercise = await findOrCreateExercise(sb, { name });
          await addRoutineExercise(sb, routine.id, exercise.id, position);
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
            <p className="text-sm leading-6 text-muted">{exerciseCount} exercises will be added as new shared routines. Your existing routines and workouts will not be changed. Weights, sets, and notes are not included in the shared file.</p>
            {template.days.map((day) => (
              <section key={day.day} className="overflow-hidden rounded-xl border border-border bg-surface-2">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h3 className="font-medium">{day.label}</h3>
                  <span className="text-xs text-muted">{day.exercises.length} exercises</span>
                </div>
                {day.exercises.length > 0 ? (
                  <ol className="divide-y divide-border">
                    {day.exercises.map((name, index) => <li key={`${name}-${index}`} className="px-3 py-2 text-sm"><span className="mr-3 text-xs text-muted">{index + 1}</span>{name}</li>)}
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

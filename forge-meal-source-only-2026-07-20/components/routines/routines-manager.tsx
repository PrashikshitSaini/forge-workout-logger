"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { Regime, RoutineWithExercises } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { RoutineEditor } from "./routine-editor";
import { RoutineForm } from "./routine-form";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getActiveRegime, getRoutinesWithExercises } from "@/lib/queries";
import { deleteRoutine } from "@/lib/mutations";

const DAY_RANK = new Map([1, 2, 3, 4, 5, 6, 0].map((d, i) => [d, i]));

export function RoutinesManager() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [loading, setLoading] = useState(true);
  const [regime, setRegime] = useState<Regime | null>(null);
  const [routines, setRoutines] = useState<RoutineWithExercises[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RoutineWithExercises | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const active = await getActiveRegime(sb);
      setRegime(active);
      setRoutines(active ? await getRoutinesWithExercises(sb, active.id) : []);
    } catch {
      toast("Couldn't load routines.", "error");
    } finally {
      setLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () =>
      [...routines].sort((a, b) => {
        const ra = DAY_RANK.get(a.day_of_week ?? 0) ?? 99;
        const rb = DAY_RANK.get(b.day_of_week ?? 0) ?? 99;
        return ra - rb || a.position - b.position;
      }),
    [routines],
  );

  async function handleDelete(routine: RoutineWithExercises) {
    if (!window.confirm(`Delete "${routine.name}"? Logged history is kept.`)) return;
    try {
      await deleteRoutine(sb, routine.id);
      setRoutines((prev) => prev.filter((r) => r.id !== routine.id));
    } catch {
      toast("Couldn't delete the day.", "error");
    }
  }

  if (loading) {
    return (
      <div className="grid flex-1 place-items-center py-24 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!regime) {
    return (
      <div className="px-4 py-16 text-center text-muted">
        Set up your first regime on the Log tab.
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Routines"
        subtitle={regime.name}
        right={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={16} /> Day
          </Button>
        }
      />

      <div className="space-y-3 px-4">
        {sorted.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            No days yet. Tap “Day” to add one.
          </p>
        ) : (
          sorted.map((r) => (
            <RoutineEditor
              key={r.id}
              routine={r}
              onEdit={() => {
                setEditing(r);
                setFormOpen(true);
              }}
              onDelete={() => handleDelete(r)}
            />
          ))
        )}
      </div>

      <RoutineForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load()}
        regimeId={regime.id}
        position={routines.length}
        initial={
          editing
            ? { id: editing.id, name: editing.name, day_of_week: editing.day_of_week }
            : undefined
        }
      />
    </>
  );
}

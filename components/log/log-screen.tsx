"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Regime, RoutineWithExercises, SessionFull } from "@/lib/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getActiveRegime,
  getLastSessionForRoutine,
  getRoutinesWithExercises,
  getSessionFull,
  getSessionIdForDate,
} from "@/lib/queries";
import { startSession } from "@/lib/mutations";
import { dayOfWeekFor, todayISODate } from "@/lib/format";
import { dayLabel } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Onboarding } from "@/components/onboarding";
import { DaySelector } from "./day-selector";
import { RoutinePreview } from "./routine-preview";
import { SessionLogger } from "./session-logger";

type Phase = "loading" | "onboard" | "ready" | "error";

export function LogScreen() {
  // Stable references so they can sit safely in effect dependency arrays.
  const [sb] = useState(() => createSupabaseBrowserClient());
  const today = useMemo(() => todayISODate(), []);

  const [phase, setPhase] = useState<Phase>("loading");
  const [regime, setRegime] = useState<Regime | null>(null);
  const [routines, setRoutines] = useState<RoutineWithExercises[]>([]);
  const [selectedDay, setSelectedDay] = useState<number>(dayOfWeekFor());

  const [dayLoading, setDayLoading] = useState(false);
  const [session, setSession] = useState<SessionFull | null>(null);
  const [lastSession, setLastSession] = useState<SessionFull | null>(null);
  const [starting, setStarting] = useState(false);

  const loadRegime = useCallback(async () => {
    setPhase("loading");
    try {
      const active = await getActiveRegime(sb);
      if (!active) {
        setPhase("onboard");
        return;
      }
      const rs = await getRoutinesWithExercises(sb, active.id);
      setRegime(active);
      setRoutines(rs);
      setPhase("ready");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't load your data.", "error");
      setPhase("error");
    }
  }, [sb]);

  useEffect(() => {
    void loadRegime();
  }, [loadRegime]);

  // Routine for the selected weekday (first match), derived from loaded routines.
  const routine = useMemo(
    () => routines.find((r) => r.day_of_week === selectedDay) ?? null,
    [routines, selectedDay],
  );
  const daysWithRoutines = useMemo(
    () => new Set(routines.map((r) => r.day_of_week).filter((d): d is number => d !== null)),
    [routines],
  );

  // Load the session (resume) or last-session reference whenever the day changes.
  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    setSession(null);
    setLastSession(null);
    if (!routine) {
      setDayLoading(false);
      return;
    }
    setDayLoading(true);
    (async () => {
      try {
        const existingId = await getSessionIdForDate(sb, routine.id, today);
        if (cancelled) return;
        const last = await getLastSessionForRoutine(sb, routine.id, today);
        if (cancelled) return;
        setLastSession(last);
        if (existingId) {
          const full = await getSessionFull(sb, existingId);
          if (!cancelled) setSession(full);
        }
      } catch {
        if (!cancelled) toast("Couldn't load this day.", "error");
      } finally {
        if (!cancelled) setDayLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, routine, sb, today]);

  async function handleStart() {
    if (!regime || !routine) return;
    setStarting(true);
    try {
      const id = await startSession(sb, regime.id, routine.id, today);
      const full = await getSessionFull(sb, id);
      setSession(full);
    } catch {
      toast("Couldn't start the workout.", "error");
    } finally {
      setStarting(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="grid flex-1 place-items-center py-24 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted">Couldn&apos;t load your data.</p>
        <Button variant="secondary" className="mt-3" onClick={() => void loadRegime()}>
          Try again
        </Button>
      </div>
    );
  }

  if (phase === "onboard") {
    return <Onboarding onReady={loadRegime} />;
  }

  return (
    <>
      <PageHeader
        title={routine ? routine.name : dayLabel(selectedDay)}
        subtitle={`${dayLabel(selectedDay)} · ${regime?.name ?? ""}`}
      />
      <div className="pb-2">
        <DaySelector
          selected={selectedDay}
          today={dayOfWeekFor()}
          daysWithRoutines={daysWithRoutines}
          onSelect={setSelectedDay}
        />
      </div>

      {dayLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : !routine ? (
        <div className="px-4 py-12 text-center">
          <p className="text-muted">No routine for {dayLabel(selectedDay)} yet.</p>
          <Link href="/routines" className="mt-3 inline-block">
            <Button variant="secondary">Build this day</Button>
          </Link>
        </div>
      ) : session ? (
        <SessionLogger session={session} lastSession={lastSession} />
      ) : (
        <RoutinePreview
          routine={routine}
          lastSession={lastSession}
          starting={starting}
          onStart={handleStart}
        />
      )}
    </>
  );
}

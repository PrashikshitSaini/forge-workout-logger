"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Exercise } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/input";
import { LineChart } from "@/components/charts/line-chart";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getExerciseHistory, getExercises, type ExerciseSetPoint } from "@/lib/queries";
import { estimateOneRepMax, formatDuration, formatShortDate, parseISODate } from "@/lib/format";
import { WEIGHT_UNIT } from "@/lib/constants";

interface SessionPoint {
  date: string;
  topWeight: number | null;
  bestE1RM: number | null;
  topReps: number | null;
  maxDuration: number | null;
}

function groupByDate(points: ExerciseSetPoint[]): SessionPoint[] {
  const byDate = new Map<string, ExerciseSetPoint[]>();
  for (const p of points) {
    const arr = byDate.get(p.performed_on) ?? [];
    arr.push(p);
    byDate.set(p.performed_on, arr);
  }
  return [...byDate.entries()]
    .map(([date, sets]) => {
      let topWeight: number | null = null;
      let topReps: number | null = null;
      let bestE1RM: number | null = null;
      let maxDuration: number | null = null;
      for (const s of sets) {
        if (s.weight != null && (topWeight == null || s.weight > topWeight)) {
          topWeight = s.weight;
          topReps = s.reps;
        }
        if (s.weight != null && s.reps != null) {
          const e = estimateOneRepMax(s.weight, s.reps);
          if (bestE1RM == null || e > bestE1RM) bestE1RM = e;
        }
        if (s.duration_seconds != null && (maxDuration == null || s.duration_seconds > maxDuration)) {
          maxDuration = s.duration_seconds;
        }
      }
      return { date, topWeight, topReps, bestE1RM, maxDuration };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function HistoryScreen() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [points, setPoints] = useState<SessionPoint[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    getExercises(sb)
      .then((list) => {
        setExercises(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch(() => toast("Couldn't load exercises.", "error"))
      .finally(() => setLoadingList(false));
  }, [sb]);

  const selected = useMemo(
    () => exercises.find((e) => e.id === selectedId) ?? null,
    [exercises, selectedId],
  );

  const loadHistory = useCallback(async () => {
    if (!selectedId) return;
    setLoadingHistory(true);
    try {
      const raw = await getExerciseHistory(sb, selectedId);
      setPoints(groupByDate(raw));
    } catch {
      toast("Couldn't load history.", "error");
    } finally {
      setLoadingHistory(false);
    }
  }, [sb, selectedId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const isCardio = selected?.type === "cardio";
  const chartData = points
    .map((p) => {
      const d = parseISODate(p.date);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const value = isCardio
        ? p.maxDuration != null
          ? Math.round(p.maxDuration / 60)
          : null
        : p.bestE1RM;
      return value != null ? { label, value } : null;
    })
    .filter((x): x is { label: string; value: number } => x !== null);

  const pr = isCardio
    ? Math.max(0, ...points.map((p) => p.maxDuration ?? 0))
    : Math.max(0, ...points.map((p) => p.bestE1RM ?? 0));

  return (
    <>
      <PageHeader title="History" subtitle="Per-exercise progress — across every regime." />

      <div className="space-y-5 px-4">
        {loadingList ? (
          <div className="grid place-items-center py-16 text-muted">
            <Loader2 className="animate-spin" />
          </div>
        ) : exercises.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">Log a workout to see history.</p>
        ) : (
          <>
            <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>

            {loadingHistory ? (
              <div className="grid place-items-center py-16 text-muted">
                <Loader2 className="animate-spin" />
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
                      {isCardio ? "Best duration" : "Estimated 1RM"}
                    </h2>
                    {pr > 0 ? (
                      <span className="tabular text-sm text-accent">
                        PR {isCardio ? formatDuration(pr) : `${pr} ${WEIGHT_UNIT}`}
                      </span>
                    ) : null}
                  </div>
                  <LineChart data={chartData} unit={isCardio ? " min" : ` ${WEIGHT_UNIT}`} />
                </div>

                <section className="space-y-2">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Sessions</h2>
                  {points.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No sessions yet.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-border bg-surface">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                            <th className="px-3 py-2 text-left font-medium">Date</th>
                            <th className="tabular px-2 py-2 text-right font-medium">
                              {isCardio ? "Duration" : "Top set"}
                            </th>
                            <th className="tabular px-3 py-2 text-right font-medium">
                              {isCardio ? "" : "e1RM"}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...points].reverse().map((p) => (
                            <tr key={p.date} className="border-b border-border last:border-0">
                              <td className="px-3 py-2">{formatShortDate(p.date)}</td>
                              <td className="tabular px-2 py-2 text-right">
                                {isCardio
                                  ? formatDuration(p.maxDuration)
                                  : p.topWeight != null
                                    ? `${p.topWeight}×${p.topReps ?? "–"}`
                                    : "–"}
                              </td>
                              <td className="tabular px-3 py-2 text-right text-muted">
                                {isCardio ? "" : p.bestE1RM != null ? `${p.bestE1RM}` : "–"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

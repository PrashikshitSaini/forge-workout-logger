"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { WEIGHT_UNIT } from "@/lib/constants";
import { formatShortDate, toISODate } from "@/lib/format";
import {
  buildProgressOverview,
  type ExerciseProgress,
  type OverviewDay,
  type OverviewSetSummary,
  type ProgressOverview,
} from "@/lib/progress-overview";
import { getCompletedOverviewSets } from "@/lib/queries";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthLabel(month: Date): string {
  return month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthDates(month: Date): (Date | null)[] {
  const first = startOfMonth(month);
  const totalDays = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const result: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= totalDays; day += 1) result.push(new Date(first.getFullYear(), first.getMonth(), day));
  while (result.length % 7 !== 0) result.push(null);
  return result;
}

export function OverviewScreen() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [overview, setOverview] = useState<ProgressOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(buildProgressOverview(await getCompletedOverviewSets(sb)));
    } catch {
      toast("Couldn't load your overview.", "error");
    } finally {
      setLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    void load();
  }, [load]);

  const dates = useMemo(() => monthDates(month), [month]);
  const selectedDay = selectedDate ? overview?.days.get(selectedDate) ?? null : null;

  if (loading || !overview) {
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const hasHistory = overview.totalCompletedSessions > 0;

  return (
    <div className="space-y-6 px-4">
      <section className="grid grid-cols-2 gap-2" aria-label="Progress summary">
        <SummaryCard
          label="Consistency"
          value={`${overview.completedSessionsThisWeek} this week`}
          detail={
            overview.averageSessionsPerWeek == null
              ? "Finish a workout to start tracking."
              : `${overview.averageSessionsPerWeek} completed workouts / week`
          }
        />
        <SummaryCard
          label="Strength"
          value={
            overview.strength.comparableLifts > 0
              ? `${overview.strength.improvedLifts} lift${overview.strength.improvedLifts === 1 ? "" : "s"} improved`
              : "Building your baseline"
          }
          detail={
            overview.strength.comparableLifts > 0
              ? "Compared with the prior 4 weeks"
              : "Complete weighted sets over time to compare."
          }
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Training consistency</h2>
          <span className="text-xs text-muted-foreground">Last 8 weeks</span>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          {overview.weeklySessions.some((week) => week.value > 0) ? (
            <ConsistencyChart data={overview.weeklySessions} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Finish a workout to see your weekly training rhythm.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Training calendar</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
                setSelectedDate(null);
              }}
              aria-label="Previous month"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-muted hover:text-foreground"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => {
                setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
                setSelectedDate(null);
              }}
              aria-label="Next month"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-muted hover:text-foreground"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-3">
          <h3 className="mb-3 text-center text-sm font-medium">{monthLabel(month)}</h3>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {label.slice(0, 1)}
              </span>
            ))}
            {dates.map((date, index) => {
              if (!date) return <span key={`blank-${index}`} aria-hidden="true" className="h-11" />;
              const iso = toISODate(date);
              const day = overview.days.get(iso);
              const isSelected = selectedDate === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedDate(iso)}
                  aria-pressed={isSelected}
                  aria-label={day ? `${formatShortDate(iso)}, ${day.sessions} completed workout${day.sessions === 1 ? "" : "s"}` : formatShortDate(iso)}
                  className={cn(
                    "relative mx-auto grid h-10 w-10 place-items-center rounded-lg text-sm tabular",
                    isSelected ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-surface-2",
                  )}
                >
                  {date.getDate()}
                  {day ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute bottom-1 h-1.5 w-1.5 rounded-full bg-accent",
                        isSelected && "bg-accent-foreground",
                      )}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Dots mark days with a completed workout.
          </p>
        </div>
      </section>

      <DayDetail date={selectedDate} day={selectedDay} hasHistory={hasHistory} />
    </div>
  );
}

function ConsistencyChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((week) => week.value), 1);
  return (
    <div>
      <div className="flex h-32 items-end gap-1.5" aria-label="Completed workouts by week">
        {data.map((week) => (
          <div key={week.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${week.value} completed workouts`}>
            <span className="text-[10px] tabular text-muted-foreground">{week.value}</span>
            <div className="flex h-24 w-full items-end rounded-t bg-surface-2">
              <div
                className="w-full rounded-t"
                style={{
                  height: week.value === 0 ? "1px" : `${Math.max(10, (week.value / max) * 100)}%`,
                  backgroundColor: "var(--accent)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {data.map((week) => (
          <span key={week.label} className="flex-1 text-center text-[10px] text-muted-foreground">
            {week.label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">Completed workouts each week</p>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-h-32 rounded-xl border border-border bg-surface p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-lg font-semibold leading-tight">{value}</p>
      <p className="mt-2 text-xs leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

function DayDetail({ date, day, hasHistory }: { date: string | null; day: OverviewDay | null; hasHistory: boolean }) {
  if (!date) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4 text-center text-sm text-muted-foreground">
        {hasHistory ? "Tap a day to see its completed workout." : "Finish a workout to start building your calendar."}
      </section>
    );
  }

  if (!day) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">{formatShortDate(date)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">No completed workout was recorded on this day.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{formatShortDate(date)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {day.routines.length > 0 ? day.routines.join(" · ") : "Completed workout"}
          </p>
        </div>
        {day.volume > 0 ? <span className="tabular text-sm text-accent">{Math.round(day.volume).toLocaleString()} {WEIGHT_UNIT}</span> : null}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {day.sessions} completed workout{day.sessions === 1 ? "" : "s"} · {day.exercises} exercise{day.exercises === 1 ? "" : "s"} · {day.completedSets} set{day.completedSets === 1 ? "" : "s"}
      </p>
      <ExerciseProgressList exercises={day.exerciseProgress} />
    </section>
  );
}

function ExerciseProgressList({ exercises }: { exercises: ExerciseProgress[] }) {
  if (exercises.length === 0) return null;
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Exercise progress</h3>
      <div className="mt-3 space-y-3">
        {exercises.map((exercise) => (
          <article key={exercise.exerciseId} className="rounded-lg bg-surface-2 p-3">
            <h4 className="text-sm font-medium">{exercise.exerciseName}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {exercise.completedSets} completed set{exercise.completedSets === 1 ? "" : "s"}
              {exercise.setSummaries.length > 0 ? ` · ${formatSetSummaries(exercise.setSummaries)}` : ""}
            </p>
            {exercise.currentEstimatedMax != null ? (
              <div className="mt-3 flex items-center gap-3">
                <TrendSparkline values={exercise.recentEstimatedMaxes} />
                <div>
                  <p className="text-xs text-muted-foreground">Estimated strength</p>
                  <p className="text-sm font-medium tabular">{Math.round(exercise.currentEstimatedMax).toLocaleString()} {WEIGHT_UNIT}</p>
                  <p className="text-xs text-muted-foreground">{exerciseComparisonLabel(exercise)}</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Add weight and reps to compare this lift over time.
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function formatSetSummaries(summaries: OverviewSetSummary[]): string {
  const visible = summaries.slice(0, 3).map((summary) => {
    const setCount = summary.count === 1 ? "" : ` (${summary.count} sets)`;
    if (summary.weight != null && summary.reps != null) return `${summary.weight} ${WEIGHT_UNIT} × ${summary.reps}${setCount}`;
    if (summary.reps != null) return `${summary.reps} reps${setCount}`;
    return `untracked${setCount}`;
  });
  const hiddenCount = summaries.length - visible.length;
  return `${visible.join(" · ")}${hiddenCount > 0 ? ` +${hiddenCount} more` : ""}`;
}

function exerciseComparisonLabel(exercise: ExerciseProgress): string {
  if (exercise.currentEstimatedMax != null && exercise.priorEstimatedMax != null) {
    const difference = Math.round(exercise.currentEstimatedMax - exercise.priorEstimatedMax);
    const change = difference === 0 ? "same" : `${difference > 0 ? "+" : ""}${difference.toLocaleString()} ${WEIGHT_UNIT}`;
    return `${change} vs prior completed session (${Math.round(exercise.priorEstimatedMax).toLocaleString()} ${WEIGHT_UNIT})`;
  }
  return "Baseline recorded — complete this lift again to compare.";
}

function TrendSparkline({ values }: { values: number[] }) {
  const width = 72;
  const height = 28;
  if (values.length < 2) {
    return (
      <div className="grid h-7 w-[72px] place-items-center" aria-label="Baseline estimated strength">
        <span className="h-2 w-2 rounded-full bg-accent" />
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 3 - ((value - min) / spread) * (height - 6);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-[72px] shrink-0" role="img" aria-label="Estimated strength over recent completed sessions">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" />
      <circle cx={width} cy={Number(points.split(" ").at(-1)?.split(",")[1])} r="2.5" className="fill-accent" />
    </svg>
  );
}

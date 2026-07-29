"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { VBars } from "@/components/charts/bars";
import { toast } from "@/components/ui/toast";
import { WEIGHT_UNIT } from "@/lib/constants";
import { formatShortDate, toISODate } from "@/lib/format";
import { buildProgressOverview, type OverviewDay, type ProgressOverview } from "@/lib/progress-overview";
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
  const calendarVolumeMax = useMemo(
    () => Math.max(0, ...(overview ? [...overview.days.values()].map((day) => day.volume) : [])),
    [overview],
  );

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
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Training volume</h2>
          <span className="text-xs text-muted-foreground">Last 8 weeks</span>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          {overview.weeklyVolume.some((week) => week.value > 0) ? (
            <VBars data={overview.weeklyVolume} unit={` ${WEIGHT_UNIT}`} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Completed weighted sets will appear here.
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
              const intensity = day && day.volume > 0 && calendarVolumeMax > 0 ? Math.ceil((day.volume / calendarVolumeMax) * 3) : 0;
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
                        "absolute bottom-1 h-1 w-1 rounded-full bg-accent",
                        !isSelected && intensity === 1 && "opacity-45",
                        !isSelected && intensity === 2 && "opacity-70",
                        !isSelected && intensity === 3 && "h-1.5 w-1.5 opacity-100",
                        isSelected && "bg-accent-foreground",
                      )}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Dots mark completed workouts. Larger dots indicate more completed strength-set volume.
          </p>
        </div>
      </section>

      <DayDetail date={selectedDate} day={selectedDay} hasHistory={hasHistory} />
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
      {day.bestSet ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Heaviest set: <span className="text-foreground">{day.bestSet.exerciseName} {day.bestSet.weight} × {day.bestSet.reps}</span>
        </p>
      ) : null}
    </section>
  );
}

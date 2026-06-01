"use client";

import { DAYS_OF_WEEK } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Monday-first order, matching how the owner thinks about his week. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function DaySelector({
  selected,
  today,
  daysWithRoutines,
  onSelect,
}: {
  selected: number;
  today: number;
  daysWithRoutines: Set<number>;
  onSelect: (day: number) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto px-4 pb-1">
      {ORDER.map((day) => {
        const meta = DAYS_OF_WEEK.find((d) => d.value === day)!;
        const isSelected = day === selected;
        const hasRoutine = daysWithRoutines.has(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => onSelect(day)}
            aria-pressed={isSelected}
            className={cn(
              "relative flex h-14 flex-1 min-w-12 flex-col items-center justify-center rounded-lg border text-xs transition",
              isSelected
                ? "border-accent bg-accent/10 text-foreground"
                : "border-border bg-surface text-muted hover:text-foreground",
            )}
          >
            {day === today ? (
              <span className="absolute right-1 top-1 text-[9px] font-medium uppercase tracking-wide text-accent">
                now
              </span>
            ) : null}
            <span className="font-semibold">{meta.short}</span>
            <span
              className={cn(
                "mt-1 h-1 w-1 rounded-full",
                hasRoutine ? "bg-accent" : "bg-border",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

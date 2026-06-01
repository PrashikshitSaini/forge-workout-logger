"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperProps {
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Small label shown under/next to the number, e.g. "lb", "reps", "min". */
  suffix?: string;
  /** Allow fractional input (e.g. bodyweight, RPE). Defaults to integers. */
  decimals?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * Thumb-first numeric control: big +/- buttons flanking a tap-to-type value.
 * The whole point of the logger — never fight a tiny keyboard mid-set.
 */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  suffix,
  decimals = false,
  className,
  ariaLabel,
}: StepperProps) {
  const clamp = (n: number) => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return decimals ? Math.round(v * 100) / 100 : Math.round(v);
  };

  const bump = (dir: 1 | -1) => {
    const base = value ?? min ?? 0;
    onChange(clamp(base + dir * step));
  };

  const handleType = (raw: string) => {
    if (raw.trim() === "") {
      onChange(null);
      return;
    }
    const parsed = decimals ? parseFloat(raw) : parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    onChange(clamp(parsed));
  };

  return (
    <div className={cn("flex items-stretch rounded-lg bg-surface-2 border border-border", className)}>
      <button
        type="button"
        aria-label={`Decrease ${ariaLabel ?? ""}`.trim()}
        onClick={() => bump(-1)}
        className="grid w-11 place-items-center text-muted hover:text-foreground active:bg-border/60 rounded-l-lg"
      >
        <Minus size={18} />
      </button>
      <div className="flex flex-1 items-baseline justify-center gap-1 px-1">
        <input
          inputMode={decimals ? "decimal" : "numeric"}
          aria-label={ariaLabel}
          value={value ?? ""}
          onChange={(e) => handleType(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="–"
          className="tabular w-full min-w-0 bg-transparent text-center text-lg font-semibold focus:outline-none"
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
      <button
        type="button"
        aria-label={`Increase ${ariaLabel ?? ""}`.trim()}
        onClick={() => bump(1)}
        className="grid w-11 place-items-center text-muted hover:text-foreground active:bg-border/60 rounded-r-lg"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}

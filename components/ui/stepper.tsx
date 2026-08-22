"use client";

import { useState } from "react";
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
  const [draft, setDraft] = useState<string | null>(null);

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

  const commitTypedValue = (raw: string) => {
    if (raw.trim() === "") {
      onChange(null);
      return;
    }
    const parsed = decimals ? Number(raw.replace(",", ".")) : Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed));
  };

  const handleType = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === "") {
      onChange(null);
      return;
    }
    // Keep an unfinished decimal visible while the user types (e.g. "10.").
    // Coercing it immediately loses the decimal point and turns the next digit
    // into a different weight on mobile keyboards.
    if (decimals && /^[+-]?\d+[.,]$/.test(raw)) return;
    commitTypedValue(raw);
  };

  return (
    <div className={cn("flex min-w-0 items-stretch rounded-lg border border-border bg-surface-2", className)}>
      <button
        type="button"
        aria-label={`Decrease ${ariaLabel ?? ""}`.trim()}
        onClick={() => bump(-1)}
        className="grid w-10 shrink-0 place-items-center rounded-l-lg text-muted hover:text-foreground active:bg-border/60"
      >
        <Minus size={18} />
      </button>
      <div className="flex flex-1 items-baseline justify-center gap-1 px-1">
        <input
          inputMode={decimals ? "decimal" : "numeric"}
          aria-label={ariaLabel}
          value={draft ?? value ?? ""}
          onChange={(e) => handleType(e.target.value)}
          onFocus={(e) => {
            setDraft(value?.toString() ?? "");
            e.currentTarget.select();
          }}
          onBlur={() => {
            if (draft !== null) commitTypedValue(draft);
            setDraft(null);
          }}
          placeholder="–"
          autoComplete="off"
          enterKeyHint="done"
          className="tabular h-11 w-full min-w-0 bg-transparent text-center text-lg font-semibold text-foreground caret-accent placeholder:text-muted-foreground focus:outline-none"
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
      <button
        type="button"
        aria-label={`Increase ${ariaLabel ?? ""}`.trim()}
        onClick={() => bump(1)}
        className="grid w-10 shrink-0 place-items-center rounded-r-lg text-muted hover:text-foreground active:bg-border/60"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}

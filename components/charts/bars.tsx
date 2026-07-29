"use client";

export interface Datum {
  label: string;
  value: number;
}

/** Horizontal labeled bars — good for category breakdowns (muscle groups). */
export function HBars({ data, unit = "" }: { data: Datum[]; unit?: string }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  }
  const max = Math.max(...data.map((d) => d.value)) || 1;
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted">{d.label}</span>
            <span className="tabular text-muted-foreground">
              {Math.round(d.value).toLocaleString()}
              {unit}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars — good for a time series (weekly volume). */
export function VBars<T extends Datum>({
  data,
  unit = "",
  height = 120,
  selectedIndex,
  onSelect,
  getAriaLabel,
}: {
  data: T[];
  unit?: string;
  height?: number;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  getAriaLabel?: (datum: T, index: number) => string;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  }
  const max = Math.max(...data.map((d) => d.value)) || 1;
  const isSelectable = onSelect !== undefined;

  const selectRelativeBar = (index: number, offset: number) => {
    if (!onSelect) return;
    onSelect(Math.min(data.length - 1, Math.max(0, index + offset)));
  };

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => (
          <button
            key={d.label}
            type="button"
            onClick={() => onSelect?.(i)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                selectRelativeBar(i, -1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                selectRelativeBar(i, 1);
              }
            }}
            className={`flex h-full flex-1 flex-col items-center justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
              isSelectable ? "cursor-pointer" : "cursor-default"
            }`}
            aria-label={getAriaLabel?.(d, i) ?? `${d.label}: ${d.value}${unit}`}
            aria-pressed={isSelectable ? selectedIndex === i : undefined}
            disabled={!isSelectable}
            title={`${d.value}${unit}`}
          >
            <div
              className="w-full rounded-t transition-opacity"
              style={{
                height: `${Math.max(2, (d.value / max) * 100)}%`,
                backgroundColor: "var(--accent)",
                opacity: selectedIndex === i ? 1 : 0.72,
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[10px] text-muted-foreground">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

"use client";

interface Datum {
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
export function VBars({ data, unit = "", height = 120 }: { data: Datum[]; unit?: string; height?: number }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  }
  const max = Math.max(...data.map((d) => d.value)) || 1;
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end" title={`${d.value}${unit}`}>
            <div
              className="w-full rounded-t bg-accent/80"
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
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

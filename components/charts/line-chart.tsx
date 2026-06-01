"use client";

interface Point {
  label: string;
  value: number;
}

/**
 * Minimal, dependency-free SVG line chart. Scales to its container width while
 * preserving aspect ratio. Shows min/max on the y-axis and first/last x labels.
 */
export function LineChart({
  data,
  unit = "",
  height = 160,
}: {
  data: Point[];
  unit?: string;
  height?: number;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>;
  }

  const W = 320;
  const H = height;
  const padX = 8;
  const padY = 16;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const x = (i: number) =>
    data.length === 1 ? W / 2 : padX + (i / (data.length - 1)) * (W - padX * 2);
  const y = (v: number) => padY + (1 - (v - min) / range) * (H - padY * 2);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.value)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
        {/* baseline + top gridlines */}
        <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="var(--border)" strokeWidth="1" />
        <line x1={padX} y1={padY} x2={W - padX} y2={padY} stroke="var(--border)" strokeWidth="0.5" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={data.length > 24 ? 1.5 : 2.5} fill="var(--accent)" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span className="tabular">{data[0].label}</span>
        <span className="tabular">
          {min === max ? `${max}${unit}` : `${min}–${max}${unit}`}
        </span>
        <span className="tabular">{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

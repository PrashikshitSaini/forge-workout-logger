"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { HBars, VBars } from "@/components/charts/bars";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getBodyStats, getSetsSince } from "@/lib/queries";
import { buildReport, mondayOf, type Report } from "@/lib/reports";
import { parseISODate, toISODate } from "@/lib/format";
import { WEIGHT_UNIT } from "@/lib/constants";
import { cn } from "@/lib/utils";

const PERIODS = [
  { weeks: 4, label: "4w" },
  { weeks: 8, label: "8w" },
  { weeks: 12, label: "12w" },
] as const;

export function ReportsScreen() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [weeks, setWeeks] = useState(8);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [bodyweight, setBodyweight] = useState<{ label: string; value: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const firstMonday = new Date(mondayOf(new Date()));
      firstMonday.setDate(firstMonday.getDate() - (weeks - 1) * 7);
      const since = toISODate(firstMonday);

      const [rows, stats] = await Promise.all([getSetsSince(sb, since), getBodyStats(sb, 365)]);
      setReport(buildReport(rows, weeks));
      setBodyweight(
        stats
          .filter((s) => s.bodyweight != null && s.recorded_on >= since)
          .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on))
          .map((s) => {
            const d = parseISODate(s.recorded_on);
            return { label: `${d.getMonth() + 1}/${d.getDate()}`, value: s.bodyweight as number };
          }),
      );
    } catch {
      toast("Couldn't load reports.", "error");
    } finally {
      setLoading(false);
    }
  }, [sb, weeks]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Reports"
        right={
          <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.weeks}
                type="button"
                onClick={() => setWeeks(p.weeks)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  weeks === p.weeks ? "bg-accent text-accent-foreground" : "text-muted",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {loading || !report ? (
        <div className="grid place-items-center py-24 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-6 px-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Sessions" value={report.sessions.toString()} />
            <Stat label="Volume" value={`${Math.round(report.totalVolume / 1000)}k`} sub={WEIGHT_UNIT} />
            <Stat label="Per week" value={report.avgSessionsPerWeek.toString()} />
          </div>

          <Section title="Weekly volume">
            <VBars data={report.weeklyVolume} unit={` ${WEIGHT_UNIT}`} />
          </Section>

          <Section title="Volume by muscle">
            <HBars data={report.muscleVolume.slice(0, 8)} unit={` ${WEIGHT_UNIT}`} />
          </Section>

          <Section title="Bodyweight">
            <LineChart data={bodyweight} unit={` ${WEIGHT_UNIT}`} />
          </Section>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-center">
      <p className="tabular text-2xl font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted">
        {label}
        {sub ? ` · ${sub}` : ""}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
      <div className="rounded-xl border border-border bg-surface p-4">{children}</div>
    </section>
  );
}

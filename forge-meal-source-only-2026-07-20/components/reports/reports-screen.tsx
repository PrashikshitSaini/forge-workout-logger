"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { HBars, VBars } from "@/components/charts/bars";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getDailyHealth, getSetsSince } from "@/lib/queries";
import { buildReport, mondayOf, type Report } from "@/lib/reports";
import { parseISODate, toISODate } from "@/lib/format";
import { WEIGHT_UNIT } from "@/lib/constants";
import { cn } from "@/lib/utils";

const PERIODS = [
  { weeks: 4, label: "4w" },
  { weeks: 8, label: "8w" },
  { weeks: 12, label: "12w" },
] as const;

function PeriodPicker({ weeks, setWeeks }: { weeks: number; setWeeks: (weeks: number) => void }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
      {PERIODS.map((period) => (
        <button
          key={period.weeks}
          type="button"
          onClick={() => setWeeks(period.weeks)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium",
            weeks === period.weeks ? "bg-accent text-accent-foreground" : "text-muted",
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

export function ReportsScreen({ embedded = false }: { embedded?: boolean } = {}) {
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

      const [rows, health] = await Promise.all([getSetsSince(sb, since), getDailyHealth(sb, 365)]);
      setReport(buildReport(rows, weeks));
      setBodyweight(
        health
          .filter((entry) => entry.bodyweight != null && entry.recorded_on >= since)
          .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on))
          .map((entry) => {
            const d = parseISODate(entry.recorded_on);
            return { label: `${d.getMonth() + 1}/${d.getDate()}`, value: entry.bodyweight as number };
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
      {!embedded ? (
        <PageHeader title="Reports" right={<PeriodPicker weeks={weeks} setWeeks={setWeeks} />} />
      ) : (
        <div className="flex justify-end px-4 pb-3">
          <PeriodPicker weeks={weeks} setWeeks={setWeeks} />
        </div>
      )}

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

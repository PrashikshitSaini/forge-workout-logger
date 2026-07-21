"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Loader2, Save, Trash2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyHealth } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getDailyHealth } from "@/lib/queries";
import { setDailyHealth, deleteDailyHealth } from "@/lib/mutations";
import { formatDuration, formatShortDate, todayISODate } from "@/lib/format";
import { WEIGHT_UNIT } from "@/lib/constants";

export function StatsScreen() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<DailyHealth[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await getDailyHealth(sb, 90));
    } catch {
      toast("Couldn't load health stats.", "error");
    } finally {
      setLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Health stats"
        subtitle="One timeline for weight and your MacroDroid watch sync."
      />

      <div className="px-4 pb-5">
        <HealthSync sb={sb} health={health} loading={loading} onChanged={load} />
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const fmtSteps = (value: number | null) => (value == null ? "–" : value.toLocaleString());
const fmtSleep = (minutes: number | null) =>
  minutes == null ? "–" : formatDuration(minutes * 60);
const fmtKcal = (value: number | null) =>
  value == null ? "–" : Math.round(value).toLocaleString();
const fmtWeight = (value: number | null) =>
  value == null ? "–" : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${WEIGHT_UNIT}`;

function HealthSync({
  sb,
  health,
  loading,
  onChanged,
}: {
  sb: SupabaseClient;
  health: DailyHealth[];
  loading: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(todayISODate());
  const [saving, setSaving] = useState(false);
  const [bodyweight, setBodyweight] = useState<number | null>(null);
  const [steps, setSteps] = useState<number | null>(null);
  const [activeKcal, setActiveKcal] = useState<number | null>(null);
  const [totalKcal, setTotalKcal] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [sleepH, setSleepH] = useState<number | null>(null);
  const [restingHr, setRestingHr] = useState<number | null>(null);
  const [avgHr, setAvgHr] = useState<number | null>(null);

  const editing = useMemo(() => health.find((entry) => entry.recorded_on === date), [health, date]);
  useEffect(() => {
    setBodyweight(editing?.bodyweight ?? null);
    setSteps(editing?.steps ?? null);
    setActiveKcal(editing?.active_kcal ?? null);
    setTotalKcal(editing?.total_kcal ?? null);
    setDistanceKm(editing?.distance_m == null ? null : Math.round(editing.distance_m) / 1000);
    setSleepH(
      editing?.sleep_minutes == null
        ? null
        : Math.round((editing.sleep_minutes / 60) * 100) / 100,
    );
    setRestingHr(editing?.resting_hr ?? null);
    setAvgHr(editing?.avg_hr ?? null);
  }, [editing]);

  async function handleSave() {
    setSaving(true);
    try {
      await setDailyHealth(sb, {
        recorded_on: date,
        bodyweight,
        steps,
        active_kcal: activeKcal,
        total_kcal: totalKcal,
        distance_m: distanceKm == null ? null : Math.round(distanceKm * 1000),
        sleep_minutes: sleepH == null ? null : Math.round(sleepH * 60),
        resting_hr: restingHr,
        avg_hr: avgHr,
        source: editing?.source ?? "manual",
      });
      toast("Health stats saved.", "success");
      await onChanged();
    } catch {
      toast("Couldn't save health stats.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete health stats for ${formatShortDate(date)}?`)) return;
    setSaving(true);
    try {
      await deleteDailyHealth(sb, date);
      toast("Entry deleted.", "success");
      await onChanged();
    } catch {
      toast("Couldn't delete entry.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="space-y-3 rounded-xl border border-accent/30 bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Activity size={17} className="text-accent" />
              MacroDroid health sync
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Synced automatically; tap a day below if you need to correct it.
            </p>
          </div>
          {editing ? (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-accent">
              {editing.source === "manual" || editing.source === "legacy_manual" ? "Manual" : "Synced"}
            </span>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="health-date">Date</Label>
          <input
            id="health-date"
            type="date"
            max={todayISODate()}
            value={date}
            onChange={(event) => setDate(event.target.value || todayISODate())}
            className="h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Weight (${WEIGHT_UNIT})`}>
            <Stepper
              value={bodyweight}
              onChange={setBodyweight}
              step={0.5}
              decimals
              max={1000}
              ariaLabel="bodyweight"
            />
          </Field>
          <Field label="Steps">
            <Stepper value={steps} onChange={setSteps} step={100} max={200000} ariaLabel="steps" />
          </Field>
          <Field label="Sleep (h)">
            <Stepper value={sleepH} onChange={setSleepH} step={0.25} decimals max={24} ariaLabel="sleep hours" />
          </Field>
          <Field label="Active kcal">
            <Stepper value={activeKcal} onChange={setActiveKcal} step={10} max={30000} ariaLabel="active calories" />
          </Field>
          <Field label="Total kcal">
            <Stepper value={totalKcal} onChange={setTotalKcal} step={10} max={30000} ariaLabel="total calories" />
          </Field>
          <Field label="Distance (km)">
            <Stepper value={distanceKm} onChange={setDistanceKm} step={0.1} decimals max={1000} ariaLabel="distance km" />
          </Field>
          <Field label="Resting HR">
            <Stepper value={restingHr} onChange={setRestingHr} step={1} max={250} ariaLabel="resting heart rate" />
          </Field>
          <Field label="Avg HR">
            <Stepper value={avgHr} onChange={setAvgHr} step={1} max={250} ariaLabel="average heart rate" />
          </Field>
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {editing ? "Update" : "Save"} {formatShortDate(date)}
          </Button>
          {editing ? (
            <Button
              variant="danger"
              size="icon"
              onClick={handleDelete}
              disabled={saving}
              aria-label="Delete entry"
            >
              <Trash2 size={18} />
            </Button>
          ) : null}
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Health history</h2>
          {!loading && health.length > 0 ? (
            <p className="text-xs text-muted-foreground">Last {health.length} days logged</p>
          ) : null}
        </div>

        {loading ? (
          <div className="grid place-items-center py-8 text-muted">
            <Loader2 className="animate-spin" />
          </div>
        ) : health.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center">
            <p className="text-sm text-muted">Nothing synced yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your first MacroDroid sync will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {health.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setDate(entry.recorded_on)}
                className={`block w-full border-b border-border p-3 text-left last:border-0 hover:bg-surface-2 ${
                  entry.recorded_on === date ? "bg-surface-2" : ""
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{formatShortDate(entry.recorded_on)}</span>
                  <span className="tabular text-sm font-semibold text-accent">
                    {fmtWeight(entry.bodyweight)}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Metric label="Steps" value={fmtSteps(entry.steps)} />
                  <Metric label="Sleep" value={fmtSleep(entry.sleep_minutes)} />
                  <Metric label="Active" value={fmtKcal(entry.active_kcal)} unit="cal" />
                  <Metric label="RHR" value={entry.resting_hr?.toString() ?? "–"} unit="bpm" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="tabular block truncate text-xs text-muted">
        {value}{value !== "–" && unit ? <span className="ml-0.5 text-[9px]">{unit}</span> : null}
      </span>
    </span>
  );
}

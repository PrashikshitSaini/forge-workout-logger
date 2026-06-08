"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import type { BodyStat, DailyHealth } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getBodyStats, getDailyHealth } from "@/lib/queries";
import { upsertBodyStat } from "@/lib/mutations";
import { formatDuration, formatRelativeDate, formatShortDate, todayISODate } from "@/lib/format";
import { WEIGHT_UNIT } from "@/lib/constants";

export function StatsScreen() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<BodyStat[]>([]);
  const [health, setHealth] = useState<DailyHealth[]>([]);

  const [recordedOn, setRecordedOn] = useState(todayISODate());
  const [bodyweight, setBodyweight] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [restingHr, setRestingHr] = useState<number | null>(null);
  const [bodyFat, setBodyFat] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bodyStats, dailyHealth] = await Promise.all([
        getBodyStats(sb, 60),
        getDailyHealth(sb, 60),
      ]);
      setStats(bodyStats);
      setHealth(dailyHealth);
    } catch {
      toast("Couldn't load stats.", "error");
    } finally {
      setLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    void load();
  }, [load]);

  // Prefill the form from the selected date's existing entry (if any).
  const editing = useMemo(() => stats.find((s) => s.recorded_on === recordedOn), [stats, recordedOn]);
  useEffect(() => {
    setBodyweight(editing?.bodyweight ?? null);
    setSleep(editing?.sleep_hours ?? null);
    setRestingHr(editing?.resting_hr ?? null);
    setBodyFat(editing?.body_fat ?? null);
    setNotes(editing?.notes ?? "");
  }, [editing]);

  async function handleSave() {
    setSaving(true);
    try {
      await upsertBodyStat(sb, {
        recorded_on: recordedOn,
        bodyweight,
        sleep_hours: sleep,
        resting_hr: restingHr,
        body_fat: bodyFat,
        notes: notes.trim() || null,
      });
      toast("Stats saved.", "success");
      await load();
    } catch {
      toast("Couldn't save stats.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Body stats" subtitle="From your Samsung Health / watch — entered by hand." />

      <div className="space-y-4 px-4">
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="space-y-1.5">
            <Label htmlFor="stat-date">Date</Label>
            <input
              id="stat-date"
              type="date"
              max={todayISODate()}
              value={recordedOn}
              onChange={(e) => setRecordedOn(e.target.value || todayISODate())}
              className="h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Bodyweight (${WEIGHT_UNIT})`}>
              <Stepper value={bodyweight} onChange={setBodyweight} step={0.5} decimals max={1000} ariaLabel="bodyweight" />
            </Field>
            <Field label="Sleep (h)">
              <Stepper value={sleep} onChange={setSleep} step={0.5} decimals max={24} ariaLabel="sleep hours" />
            </Field>
            <Field label="Resting HR">
              <Stepper value={restingHr} onChange={setRestingHr} step={1} max={250} ariaLabel="resting heart rate" />
            </Field>
            <Field label="Body fat (%)">
              <Stepper value={bodyFat} onChange={setBodyFat} step={0.5} decimals max={100} ariaLabel="body fat" />
            </Field>
          </div>

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Notes…"
          />

          <Button className="w-full" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {editing ? "Update" : "Save"} {formatShortDate(recordedOn)}
          </Button>
        </div>

        <WatchSynced health={health} loading={loading} />

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">History</h2>
          {loading ? (
            <div className="grid place-items-center py-8 text-muted">
              <Loader2 className="animate-spin" />
            </div>
          ) : stats.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No stats logged yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="tabular px-2 py-2 text-right font-medium">{WEIGHT_UNIT}</th>
                    <th className="tabular px-2 py-2 text-right font-medium">Sleep</th>
                    <th className="tabular px-3 py-2 text-right font-medium">RHR</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setRecordedOn(s.recorded_on)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-3 py-2">{formatShortDate(s.recorded_on)}</td>
                      <td className="tabular px-2 py-2 text-right">{s.bodyweight ?? "–"}</td>
                      <td className="tabular px-2 py-2 text-right">{s.sleep_hours ?? "–"}</td>
                      <td className="tabular px-3 py-2 text-right">{s.resting_hr ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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

/* ── Watch-synced daily metrics (read-only) ──────────────────────────────── */

const fmtSteps = (n: number | null) => (n == null ? "–" : n.toLocaleString());
const fmtSleep = (m: number | null) => (m == null ? "–" : formatDuration(m * 60));
const fmtKcal = (k: number | null) => (k == null ? "–" : Math.round(k).toLocaleString());

function WatchSynced({ health, loading }: { health: DailyHealth[]; loading: boolean }) {
  const latest = health[0];

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
        Watch — synced automatically
      </h2>

      {loading ? (
        <div className="grid place-items-center py-8 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : !latest ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing synced yet. Once your phone sends watch data, it shows up here.
        </p>
      ) : (
        <>
          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-muted-foreground">{formatRelativeDate(latest.recorded_on)}</p>
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Steps" value={fmtSteps(latest.steps)} />
              <Tile label="Sleep" value={fmtSleep(latest.sleep_minutes)} />
              <Tile label="Active kcal" value={fmtKcal(latest.active_kcal)} />
              <Tile label="Resting HR" value={latest.resting_hr == null ? "–" : String(latest.resting_hr)} />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="tabular px-2 py-2 text-right font-medium">Steps</th>
                  <th className="tabular px-2 py-2 text-right font-medium">Sleep</th>
                  <th className="tabular px-2 py-2 text-right font-medium">Cal</th>
                  <th className="tabular px-3 py-2 text-right font-medium">RHR</th>
                </tr>
              </thead>
              <tbody>
                {health.map((h) => (
                  <tr key={h.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{formatShortDate(h.recorded_on)}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtSteps(h.steps)}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtSleep(h.sleep_minutes)}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtKcal(h.active_kcal)}</td>
                    <td className="tabular px-3 py-2 text-right">{h.resting_hr ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

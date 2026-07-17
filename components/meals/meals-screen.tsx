"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Search, Sparkles, Trash2 } from "lucide-react";
import type { MealWithItems } from "@/lib/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getMeals } from "@/lib/queries";
import { deleteMeal } from "@/lib/mutations";
import { mealMacros } from "@/lib/nutrition";
import { DATA_CHANGED_EVENT } from "@/lib/events";
import { formatShortDate, todayISODate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface AnalyzeResponse {
  error?: string;
  title?: string;
  totals?: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
}

export function MealsScreen() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [loggedOn, setLoggedOn] = useState(todayISODate());
  const [text, setText] = useState("");
  const [meals, setMeals] = useState<MealWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMeals(await getMeals(sb, 100));
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast(
        /meals|schema cache|relation/i.test(message)
          ? "Meal storage is not ready. Apply migration 0005."
          : "Couldn't load meals.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    void load();
  }, [load]);

  const dayMeals = useMemo(
    () => meals.filter((meal) => meal.logged_on === loggedOn),
    [meals, loggedOn],
  );
  const totals = useMemo(() => mealMacros(dayMeals), [dayMeals]);

  async function handleAnalyze() {
    const mealText = text.trim();
    if (!mealText || analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/meals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: mealText, logged_on: loggedOn }),
      });
      const json = (await res.json().catch(() => ({}))) as AnalyzeResponse;
      if (!res.ok) throw new Error(json.error || "Couldn't research that meal.");
      setText("");
      await load();
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
      const calories = json.totals?.calories ? ` · ${Math.round(json.totals.calories)} cal` : "";
      toast(`${json.title || "Meal"} logged${calories}.`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't research that meal.", "error");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDelete(meal: MealWithItems) {
    if (!window.confirm(`Delete "${meal.title}"?`)) return;
    setDeletingId(meal.id);
    try {
      await deleteMeal(sb, meal.id);
      setMeals((current) => current.filter((item) => item.id !== meal.id));
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
      toast("Meal deleted.", "success");
    } catch {
      toast("Couldn't delete that meal.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Meals"
        subtitle="Say what you ate. Forge researches it and logs the macros."
      />

      <div className="space-y-5 px-4">
        <section className="space-y-3 rounded-xl border border-accent/30 bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles size={17} className="text-accent" />
            Natural-language meal log
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="meal-date">Date</Label>
            <input
              id="meal-date"
              type="date"
              max={todayISODate()}
              value={loggedOn}
              onChange={(event) => setLoggedOn(event.target.value || todayISODate())}
              className="h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
          </div>

          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void handleAnalyze();
              }
            }}
            rows={5}
            maxLength={5000}
            placeholder="I made a bowl with 100 g cooked Great Value rice, 1 cup Great Value black beans, and 150 g plant-based ground beef…"
          />

          <Button className="w-full" size="lg" onClick={handleAnalyze} disabled={!text.trim() || analyzing}>
            {analyzing ? (
              <><Loader2 size={18} className="animate-spin" /> Researching labels…</>
            ) : (
              <><Search size={18} /> Research & log meal</>
            )}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Branded foods are checked against web sources. Estimates and assumptions stay visible below.
          </p>
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Daily macros</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{formatShortDate(loggedOn)}</p>
            </div>
            <p className="text-xs text-muted-foreground">{dayMeals.length} {dayMeals.length === 1 ? "meal" : "meals"}</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Macro label="Calories" value={Math.round(totals.calories).toString()} />
            <Macro label="Protein" value={formatMacro(totals.protein_g)} unit="g" />
            <Macro label="Carbs" value={formatMacro(totals.carbs_g)} unit="g" />
            <Macro label="Fat" value={formatMacro(totals.fat_g)} unit="g" />
          </div>
        </section>

        <section className="space-y-3 pb-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Logged meals</h2>
          {loading ? (
            <div className="grid place-items-center py-10 text-muted"><Loader2 className="animate-spin" /></div>
          ) : dayMeals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-10 text-center">
              <p className="text-sm text-muted">Nothing logged for this day.</p>
              <p className="mt-1 text-xs text-muted-foreground">Describe the entire meal above in one message.</p>
            </div>
          ) : (
            dayMeals.map((meal) => (
              <MealCard
                key={meal.id}
                meal={meal}
                deleting={deletingId === meal.id}
                onDelete={() => void handleDelete(meal)}
              />
            ))
          )}
        </section>
      </div>
    </>
  );
}

function formatMacro(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function Macro({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface px-2 py-3 text-center">
      <p className="tabular truncate text-lg font-semibold leading-none">
        {value}<span className="text-[10px] font-normal text-muted">{unit}</span>
      </p>
      <p className="mt-1 truncate text-[10px] text-muted">{label}</p>
    </div>
  );
}

function MealCard({
  meal,
  deleting,
  onDelete,
}: {
  meal: MealWithItems;
  deleting: boolean;
  onDelete: () => void;
}) {
  const macros = mealMacros([meal]);
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-accent">{meal.meal_type}</p>
          <h3 className="truncate font-semibold">{meal.title}</h3>
          <p className="mt-1 text-xs text-muted">
            <span className="tabular">{macros.calories}</span> cal · <span className="tabular">{formatMacro(macros.protein_g)}</span>g protein
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Delete meal" onClick={onDelete} disabled={deleting}>
          {deleting ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
        </Button>
      </div>

      <div className="border-t border-border">
        {meal.meal_items.map((item) => (
          <div key={item.id} className="border-b border-border px-4 py-3 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {item.brand ? `${item.brand} ` : ""}{item.name}
                </p>
                <p className="text-xs text-muted">{item.quantity}</p>
              </div>
              <p className="tabular shrink-0 text-sm">{Math.round(Number(item.calories))} cal</p>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
              <span className="tabular">
                P {formatMacro(Number(item.protein_g))} · C {formatMacro(Number(item.carbs_g))} · F {formatMacro(Number(item.fat_g))}
              </span>
              {item.source_url ? (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline"
                >
                  Source <ExternalLink size={10} />
                </a>
              ) : (
                <span className={cn("shrink-0 capitalize", item.confidence === "low" && "text-warning")}>
                  {item.confidence} confidence
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {meal.assumptions.length > 0 ? (
        <div className="border-t border-border bg-surface-2 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-warning">Assumptions</p>
          <ul className="mt-1 space-y-1 text-xs leading-relaxed text-muted">
            {meal.assumptions.map((assumption, index) => <li key={index}>• {assumption}</li>)}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

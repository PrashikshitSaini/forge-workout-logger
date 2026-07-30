"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Pencil, Search, Sparkles, Trash2 } from "lucide-react";
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
import type { ReusableMeal } from "@/lib/meal-jobs";

interface AnalyzeResponse {
  error?: string;
  title?: string;
  totals?: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  duplicate?: { meal_id: string; title: string };
}

export function MealsScreen() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [loggedOn, setLoggedOn] = useState(todayISODate());
  const [text, setText] = useState("");
  const [meals, setMeals] = useState<MealWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingMeal, setUpdatingMeal] = useState<MealWithItems | null>(null);
  const [duplicate, setDuplicate] = useState<NonNullable<AnalyzeResponse["duplicate"]> | null>(null);
  const [reusableMeals, setReusableMeals] = useState<ReusableMeal[]>([]);
  const [copyPreview, setCopyPreview] = useState<{ kind: "reusable" | "history"; id: string; title: string; calories: number; status?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loadedMeals = await getMeals(sb, 100);
      setMeals(loadedMeals);
      const reusableResponse = await fetch("/api/meals/reusable").catch(() => null);
      if (reusableResponse?.ok) setReusableMeals((await reusableResponse.json() as { reusable_meals: ReusableMeal[] }).reusable_meals);
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
  const yesterday = useMemo(() => {
    const [year, month, day] = loggedOn.split("-").map(Number);
    const date = new Date(year, (month ?? 1) - 1, day ?? 1);
    date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }, [loggedOn]);
  const yesterdayMeals = useMemo(() => meals.filter((meal) => meal.logged_on === yesterday), [meals, yesterday]);

  async function handleAnalyze(options: { mealId?: string; allowDuplicate?: boolean } = {}) {
    const mealText = text.trim();
    if (!mealText || analyzing) return;
    setAnalyzing(true);
    setDuplicate(null);
    try {
      const res = await fetch("/api/meals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: mealText,
          logged_on: loggedOn,
          ...(options.mealId ? { meal_id: options.mealId } : {}),
          ...(options.allowDuplicate ? { allow_duplicate: true } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as AnalyzeResponse;
      if (res.status === 409 && json.duplicate) {
        setDuplicate(json.duplicate);
        return;
      }
      if (!res.ok) throw new Error(json.error || "Couldn't research that meal.");
      setText("");
      setUpdatingMeal(null);
      await load();
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
      const calories = json.totals?.calories ? ` · ${Math.round(json.totals.calories)} cal` : "";
      toast(`${json.title || "Meal"} ${options.mealId ? "updated" : "logged"}${calories}.`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't research that meal.", "error");
    } finally {
      setAnalyzing(false);
    }
  }

  async function confirmCopy() {
    if (!copyPreview) return;
    const body = copyPreview.kind === "reusable" ? { reusable_id: copyPreview.id, logged_on: loggedOn } : { source_meal_id: copyPreview.id, logged_on: loggedOn };
    const response = await fetch("/api/meals/reusable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { toast("Couldn't copy that meal.", "error"); return; }
    setCopyPreview(null); await load(); window.dispatchEvent(new Event(DATA_CHANGED_EVENT)); toast("Meal copied to this day.", "success");
  }

  async function saveReusable(meal: MealWithItems) {
    const name = window.prompt("Name this reusable meal", meal.title);
    if (!name?.trim()) return;
    const response = await fetch("/api/meals/reusable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meal_id: meal.id, name }) });
    if (!response.ok) { toast("Couldn't save reusable meal.", "error"); return; }
    await load(); toast("Saved for reuse.", "success");
  }

  function handleEdit(meal: MealWithItems) {
    setUpdatingMeal(meal);
    setDuplicate(null);
    setLoggedOn(meal.logged_on);
    setText(meal.original_input);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
              onChange={(event) => {
                setLoggedOn(event.target.value || todayISODate());
                setDuplicate(null);
              }}
              className="h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
          </div>

          <Textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDuplicate(null);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void handleAnalyze(updatingMeal ? { mealId: updatingMeal.id } : {});
              }
            }}
            rows={5}
            maxLength={5000}
            placeholder="I made a bowl with 100 g cooked Great Value rice, 1 cup Great Value black beans, and 150 g plant-based ground beef…"
          />

          {updatingMeal ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
              <p className="min-w-0 truncate">Updating <span className="font-medium">{updatingMeal.title}</span></p>
              <button
                type="button"
                onClick={() => {
                  setUpdatingMeal(null);
                  setText("");
                }}
                className="shrink-0 text-xs font-medium text-accent hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : null}

          {duplicate ? (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm">This looks similar to <span className="font-medium">{duplicate.title}</span>, already logged today.</p>
              <p className="text-xs text-muted-foreground">Choose how to save it. Forge will never merge meals automatically.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" onClick={() => void handleAnalyze({ mealId: duplicate.meal_id })} disabled={analyzing}>
                  Update existing
                </Button>
                <Button size="sm" onClick={() => void handleAnalyze({ allowDuplicate: true })} disabled={analyzing}>
                  Log another
                </Button>
              </div>
            </div>
          ) : null}

          <Button className="w-full" size="lg" onClick={() => void handleAnalyze(updatingMeal ? { mealId: updatingMeal.id } : {})} disabled={!text.trim() || analyzing}>
            {analyzing ? (
              <><Loader2 size={18} className="animate-spin" /> Researching & verifying…</>
            ) : updatingMeal ? (
              <><Search size={18} /> Re-research & update meal</>
            ) : (
              <><Search size={18} /> Research & verify meal</>
            )}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Forge researches the best available label, scales it to your serving, and always keeps the source confidence visible.
          </p>
        </section>

        {copyPreview ? <section className="space-y-2 rounded-xl border border-accent/40 bg-accent/10 p-4"><p className="text-sm font-medium">Matched {copyPreview.title}</p><p className="text-xs text-muted">{copyPreview.calories} cal{copyPreview.status ? ` · ${copyPreview.status}` : ""}. Review before saving.</p><div className="flex gap-2"><Button size="sm" onClick={() => void confirmCopy()}>Use this meal</Button><Button size="sm" variant="secondary" onClick={() => setCopyPreview(null)}>Cancel</Button></div></section> : null}

        {reusableMeals.length ? <section className="space-y-2"><h2 className="text-xs font-medium uppercase tracking-wide text-muted">Saved meals</h2>{reusableMeals.map((meal) => <button key={meal.id} type="button" className="w-full rounded-lg border border-border bg-surface p-3 text-left text-sm" onClick={() => setCopyPreview({ kind: "reusable", id: meal.id, title: meal.name, calories: Number((meal.items as Array<{ calories?: number }>).reduce((sum, item) => sum + Number(item.calories ?? 0), 0)), status: meal.nutrition_status })}>{meal.name} <span className="text-xs text-muted">· {meal.nutrition_status}</span></button>)}</section> : null}

        {yesterdayMeals.length ? <section className="space-y-2"><h2 className="text-xs font-medium uppercase tracking-wide text-muted">Same as yesterday</h2>{yesterdayMeals.map((meal) => <button key={meal.id} type="button" className="w-full rounded-lg border border-border bg-surface p-3 text-left text-sm" onClick={() => setCopyPreview({ kind: "history", id: meal.id, title: meal.title, calories: Number(mealMacros([meal]).calories), status: meal.nutrition_status })}>{meal.meal_type} · {meal.title}</button>)}</section> : null}


        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Daily macros</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{formatShortDate(loggedOn)}</p>
            </div>
            <p className="text-xs text-muted-foreground">{dayMeals.length} {dayMeals.length === 1 ? "meal" : "meals"}</p>
          </div>
          <MacroBreakdown totals={totals} />
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
                onEdit={() => handleEdit(meal)}
                onDelete={() => void handleDelete(meal)}
                onSaveReusable={() => void saveReusable(meal)}
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

function MacroBreakdown({
  totals,
}: {
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
}) {
  const proteinCalories = totals.protein_g * 4;
  const carbCalories = totals.carbs_g * 4;
  const fatCalories = totals.fat_g * 9;
  const macroCalories = proteinCalories + carbCalories + fatCalories;
  const proteinPct = macroCalories > 0 ? (proteinCalories / macroCalories) * 100 : 0;
  const carbPct = macroCalories > 0 ? (carbCalories / macroCalories) * 100 : 0;
  const proteinEnd = proteinPct;
  const carbEnd = proteinPct + carbPct;
  const chartBackground =
    macroCalories > 0
      ? `conic-gradient(var(--accent) 0 ${proteinEnd}%, #60a5fa ${proteinEnd}% ${carbEnd}%, var(--warning) ${carbEnd}% 100%)`
      : "var(--surface-2)";

  return (
    <div className="flex items-center gap-5 rounded-xl border border-border bg-surface p-4">
      <div
        role="img"
        aria-label={`Macro calories: ${Math.round(proteinPct)} percent protein, ${Math.round(carbPct)} percent carbs, ${Math.round(100 - proteinPct - carbPct)} percent fat`}
        className="relative grid h-32 w-32 shrink-0 place-items-center rounded-full"
        style={{ background: chartBackground }}
      >
        <div className="grid h-20 w-20 place-items-center rounded-full bg-surface text-center">
          <div>
            <p className="tabular text-xl font-semibold leading-none">{Math.round(totals.calories)}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted">calories</p>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <MacroLegend color="bg-accent" label="Protein" value={totals.protein_g} />
        <MacroLegend color="bg-blue-400" label="Carbs" value={totals.carbs_g} />
        <MacroLegend color="bg-warning" label="Fat" value={totals.fat_g} />
      </div>
    </div>
  );
}

function MacroLegend({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
      <span className="min-w-0 flex-1 truncate text-xs text-muted">{label}</span>
      <span className="tabular text-sm font-medium">
        {formatMacro(value)}<span className="text-[10px] font-normal text-muted">g</span>
      </span>
    </div>
  );
}

function MealCard({
  meal,
  deleting,
  onEdit,
  onDelete,
  onSaveReusable,
}: {
  meal: MealWithItems;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSaveReusable: () => void;
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
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Edit and re-research meal" onClick={onEdit} disabled={deleting}>
            <Pencil size={16} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete meal" onClick={onDelete} disabled={deleting}>
            {deleting ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
          </Button>
          <button type="button" className="text-xs text-accent" onClick={onSaveReusable} disabled={deleting}>Save</button>
        </div>
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

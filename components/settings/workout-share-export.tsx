"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Download, Loader2, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  buildWorkoutShareFile,
  getWorkoutShareCart,
  SHARE_WEEKDAYS,
  type ShareCart,
  type ShareWeekday,
} from "@/lib/workout-share-export";

function move(items: string[], index: number, direction: -1 | 1): string[] {
  const destination = index + direction;
  if (destination < 0 || destination >= items.length) return items;
  const next = [...items];
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next;
}

export function WorkoutShareExport() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<ShareCart | null>(null);
  const [selectedDays, setSelectedDays] = useState<ShareWeekday[]>(SHARE_WEEKDAYS.map(({ day }) => day));

  async function openCart() {
    setOpen(true);
    if (cart) return;
    setLoading(true);
    try {
      setCart(await getWorkoutShareCart(createSupabaseBrowserClient()));
    } catch {
      toast("Couldn't load your workout history.", "error");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function toggleDay(day: ShareWeekday) {
    setSelectedDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);
  }

  function updateDay(day: ShareWeekday, items: string[]) {
    setCart((current) => current ? { ...current, [day]: items } : current);
  }

  function downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportFile() {
    if (!cart || selectedDays.length === 0) {
      toast("Select at least one day to export.", "error");
      return;
    }
    const payload = buildWorkoutShareFile(cart, selectedDays);
    const file = new File(
      [JSON.stringify(payload, null, 2)],
      "forge-workout-template.json",
      { type: "application/json" },
    );

    downloadFile(file);
    toast("Workout template downloaded.", "success");
  }

  const exportedExercises = cart
    ? selectedDays.reduce<number>((total, day) => total + cart[day].length, 0)
    : 0;

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Share workouts</h2>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex gap-3">
          <Share2 size={18} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <p className="font-medium">Workout template cart</p>
            <p className="mt-1 text-xs leading-5 text-muted">Build one simple file from every exercise you&apos;ve ever logged, organized by day. No weights or notes are shared.</p>
          </div>
        </div>
        <Button className="mt-3 w-full" onClick={() => void openCart()}>
          <Share2 size={16} /> Build share file
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Workout export cart"
        footer={
          <Button className="w-full" onClick={exportFile} disabled={loading || !cart || selectedDays.length === 0}>
            <Download size={16} /> Download export ({exportedExercises})
          </Button>
        }
      >
        {loading ? (
          <div className="grid place-items-center py-12 text-muted"><Loader2 className="animate-spin" /></div>
        ) : cart ? (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-muted">This is one file. Every selected day includes all exercises you have ever actually logged on that day. Remove or reorder anything before sharing.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSelectedDays(SHARE_WEEKDAYS.map(({ day }) => day))}>All days</Button>
              {SHARE_WEEKDAYS.map(({ day, label }) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`rounded-full border px-3 py-2 text-xs font-medium ${selectedDays.includes(day) ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface-2 text-muted"}`}
                  aria-pressed={selectedDays.includes(day)}
                >
                  {label.slice(0, 3)}
                </button>
              ))}
            </div>
            {SHARE_WEEKDAYS.filter(({ day }) => selectedDays.includes(day)).map(({ day, label }) => (
              <section key={day} className="overflow-hidden rounded-xl border border-border bg-surface-2">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h3 className="font-medium">{label}</h3>
                  <span className="text-xs text-muted">{cart[day].length} exercises</span>
                </div>
                {cart[day].length > 0 ? (
                  <ol className="divide-y divide-border">
                    {cart[day].map((name, index) => (
                      <li key={`${name}-${index}`} className="flex items-center gap-2 px-3 py-2">
                        <span className="w-5 text-center text-xs text-muted">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => updateDay(day, move(cart[day], index, -1))}><ArrowUp size={15} /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move ${name} down`} disabled={index === cart[day].length - 1} onClick={() => updateDay(day, move(cart[day], index, 1))}><ArrowDown size={15} /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-danger" aria-label={`Remove ${name}`} onClick={() => updateDay(day, cart[day].filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></Button>
                      </li>
                    ))}
                  </ol>
                ) : <p className="px-3 py-4 text-sm text-muted">No exercises logged on {label} yet.</p>}
              </section>
            ))}
            <p className="flex items-center gap-2 text-xs leading-5 text-muted"><Download size={14} /> This downloads one JSON file, ready to send anywhere or import into Forge.</p>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

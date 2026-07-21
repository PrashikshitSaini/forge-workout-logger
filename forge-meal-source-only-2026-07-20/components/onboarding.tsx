"use client";

import { useState } from "react";
import { Dumbbell, Loader2, Plus } from "lucide-react";
import { Logo } from "@/components/logo";
import { toast } from "@/components/ui/toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createBlankRegime, seedStarter } from "@/lib/seed";

/** First-run setup. Seeds the Monday chest routine, or starts blank. */
export function Onboarding({ onReady }: { onReady: () => void }) {
  const [busy, setBusy] = useState<null | "seed" | "blank">(null);

  async function run(kind: "seed" | "blank") {
    setBusy(kind);
    try {
      const sb = createSupabaseBrowserClient();
      if (kind === "seed") await seedStarter(sb);
      else await createBlankRegime(sb);
      onReady();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Setup failed.", "error");
      setBusy(null);
    }
  }

  return (
    <div className="px-4 py-10">
      <Logo size={34} className="mb-6" />
      <h1 className="text-2xl font-semibold tracking-tight">Let&apos;s set up.</h1>
      <p className="mt-1 text-sm text-muted">
        Start with your Monday chest day pre-loaded, then build the rest of your week as you go.
      </p>

      <div className="mt-8 space-y-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("seed")}
          className="flex w-full items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-4 text-left disabled:opacity-50"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            {busy === "seed" ? <Loader2 className="animate-spin" size={20} /> : <Dumbbell size={20} />}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Seed my Monday (chest)</span>
            <span className="block text-sm text-muted">
              Incline DB press, machine press, pec deck, cable fly, lateral raise, pushdowns, stair master.
            </span>
          </span>
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("blank")}
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left disabled:opacity-50"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
            {busy === "blank" ? <Loader2 className="animate-spin" size={20} /> : <Plus size={20} />}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Start blank</span>
            <span className="block text-sm text-muted">Build every day yourself from scratch.</span>
          </span>
        </button>
      </div>
    </div>
  );
}

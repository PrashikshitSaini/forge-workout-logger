"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ListChecks, Loader2, LogOut, RefreshCw } from "lucide-react";
import type { Regime } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ChangeRegimeModal } from "./change-regime-modal";
import { WorkoutExportSettings } from "./workout-export-settings";
import { WorkoutShareExport } from "./workout-share-export";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getActiveRegime, getRegimes } from "@/lib/queries";
import { formatShortDate } from "@/lib/format";

export function SettingsScreen() {
  const [sb] = useState(() => createSupabaseBrowserClient());
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [active, setActive] = useState<Regime | null>(null);
  const [regimes, setRegimes] = useState<Regime[]>([]);
  const [changeOpen, setChangeOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: userData }, activeRegime, all] = await Promise.all([
        sb.auth.getUser(),
        getActiveRegime(sb),
        getRegimes(sb),
      ]);
      setEmail(userData.user?.email ?? null);
      setActive(activeRegime);
      setRegimes(all);
    } catch {
      toast("Couldn't load settings.", "error");
    } finally {
      setLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await sb.auth.signOut();
      router.push("/login");
    } catch {
      toast("Couldn't sign out.", "error");
      setSigningOut(false);
    }
  }

  const archived = regimes.filter((r) => !r.is_active);

  if (loading) {
    return (
      <div className="grid flex-1 place-items-center py-24 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Settings" subtitle={email ?? undefined} />

      <div className="space-y-6 px-4">
        {/* Current regime */}
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Current regime</h2>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="font-semibold">{active?.name ?? "—"}</p>
            {active ? (
              <p className="text-xs text-muted">Started {formatShortDate(active.started_on)}</p>
            ) : null}
            {active ? (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                onClick={() => setChangeOpen(true)}
              >
                <RefreshCw size={16} /> Change regime
              </Button>
            ) : null}
          </div>
        </section>

        {/* Manage */}
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Manage</h2>
          <Link
            href="/routines"
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-accent/50"
          >
            <ListChecks size={18} className="text-accent" />
            <span className="flex-1 font-medium">Routines &amp; exercises</span>
            <ChevronRight size={18} className="text-muted-foreground" />
          </Link>
        </section>

        <WorkoutExportSettings />
        <WorkoutShareExport />

        {/* Past regimes */}
        {archived.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Past regimes</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {archived.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-3">
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="tabular shrink-0 text-xs text-muted">
                    {formatShortDate(r.started_on)}
                    {r.ended_on ? ` – ${formatShortDate(r.ended_on)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Account */}
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Account</h2>
          <Button variant="danger" className="w-full" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
            Sign out
          </Button>
        </section>
      </div>

      {active ? (
        <ChangeRegimeModal
          open={changeOpen}
          onClose={() => setChangeOpen(false)}
          currentRegime={active}
          onSwitched={() => {
            void load();
            router.push("/");
          }}
        />
      ) : null}
    </>
  );
}

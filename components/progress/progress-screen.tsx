"use client";

import { useState } from "react";
import { HistoryScreen } from "@/components/history/history-screen";
import { ReportsScreen } from "@/components/reports/reports-screen";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

type View = "history" | "reports";

export function ProgressScreen() {
  const [view, setView] = useState<View>("history");
  return (
    <>
      <PageHeader title="Progress" subtitle="Your lift history and training trends." />
      <div className="px-4 pb-5">
        <div className="grid grid-cols-2 rounded-lg border border-border bg-surface p-0.5">
          {(["history", "reports"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium capitalize",
                view === option ? "bg-accent text-accent-foreground" : "text-muted",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {view === "history" ? <HistoryScreen embedded /> : <ReportsScreen embedded />}
    </>
  );
}

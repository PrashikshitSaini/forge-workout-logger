"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ToastKind = "info" | "error" | "success";
interface ToastDetail {
  id: number;
  message: string;
  kind: ToastKind;
}

const EVENT = "forge:toast";
let counter = 0;

/** Fire a toast from anywhere (no provider plumbing required). */
export function toast(message: string, kind: ToastKind = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(EVENT, {
      detail: { id: ++counter, message, kind },
    }),
  );
}

/** Mount once near the app root. Renders stacked, auto-dismissing toasts. */
export function Toaster() {
  const [toasts, setToasts] = React.useState<ToastDetail[]>([]);

  React.useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      setToasts((prev) => [...prev, detail]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== detail.id));
      }, 3500);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-sm shadow-lg",
            t.kind === "error" && "bg-surface border-danger/50 text-foreground",
            t.kind === "success" && "bg-surface border-accent/50 text-foreground",
            t.kind === "info" && "bg-surface border-border text-foreground",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

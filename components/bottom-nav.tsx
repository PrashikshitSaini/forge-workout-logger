"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesCombined, Dumbbell, HeartPulse, Settings, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Log", icon: Dumbbell },
  { href: "/meals", label: "Meals", icon: UtensilsCrossed },
  { href: "/progress", label: "Progress", icon: ChartNoAxesCombined },
  { href: "/stats", label: "Stats", icon: HeartPulse },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur pb-safe">
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors",
                active ? "text-accent" : "text-muted hover:text-foreground",
              )}
            >
              <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

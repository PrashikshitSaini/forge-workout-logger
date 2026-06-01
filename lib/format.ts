/** Small, dependency-free formatting + date helpers (local-time aware). */

/** Today's date as YYYY-MM-DD in the user's local timezone. */
export function todayISODate(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local day-of-week (0=Sun…6=Sat) for an ISO date string, or today. */
export function dayOfWeekFor(isoDate?: string): number {
  const d = isoDate ? parseISODate(isoDate) : new Date();
  return d.getDay();
}

/** Parse YYYY-MM-DD as a local date (avoids UTC off-by-one). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatShortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Today" / "Yesterday" / short date. */
export function formatRelativeDate(iso: string): string {
  const today = todayISODate();
  if (iso === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISODate(y)) return "Yesterday";
  return formatShortDate(iso);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "–";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Epley estimated 1-rep-max. Used in progression reports + AI context. */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

/** Volume (load × reps) for a single strength set. */
export function setVolume(weight: number | null, reps: number | null): number {
  if (weight == null || reps == null) return 0;
  return weight * reps;
}

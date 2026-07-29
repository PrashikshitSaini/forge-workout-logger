"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { reorderSessionExercisesAndRoutine, updateSet, type SetPatch } from "./mutations";

// This is deliberately a tiny crash-recovery journal, not an offline queue.
// It holds only unsaved edits from the current workout and is cleared on success.
const STORAGE_KEY = "workout-recovery-journal-v1";

type PendingSet = { sessionId: string; patch: SetPatch; revision: number };
type PendingReorder = { orderedIds: string[]; revision: number };
type PendingWrites = {
  sets: Record<string, PendingSet>;
  reorders: Record<string, PendingReorder>;
};

const EMPTY: PendingWrites = { sets: {}, reorders: {} };

function read(): PendingWrites {
  if (typeof window === "undefined") return EMPTY;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return { sets: {}, reorders: {} };
    return { sets: value.sets ?? {}, reorders: value.reorders ?? {} };
  } catch {
    return { sets: {}, reorders: {} };
  }
}

function write(value: PendingWrites) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function queueSetPatch(sessionId: string, setId: string, patch: SetPatch) {
  const pending = read();
  const previous = pending.sets[setId];
  pending.sets[setId] = {
    sessionId,
    patch: { ...previous?.patch, ...patch },
    revision: (previous?.revision ?? 0) + 1,
  };
  write(pending);
}

export function getPendingSetPatch(setId: string): SetPatch | undefined {
  return read().sets[setId]?.patch;
}

export function queueReorder(sessionId: string, orderedIds: string[]) {
  const pending = read();
  const previous = pending.reorders[sessionId];
  pending.reorders[sessionId] = {
    orderedIds,
    revision: (previous?.revision ?? 0) + 1,
  };
  write(pending);
}

export function getPendingReorder(sessionId: string): string[] | undefined {
  return read().reorders[sessionId]?.orderedIds;
}

export async function flushPendingSet(sb: SupabaseClient, setId: string): Promise<boolean> {
  const snapshot = read().sets[setId];
  if (!snapshot) return true;
  try {
    await updateSet(sb, setId, snapshot.patch);
    const pending = read();
    if (pending.sets[setId]?.revision === snapshot.revision) {
      delete pending.sets[setId];
      write(pending);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Flushes all recovered set edits before the order change that accompanies them. */
export async function flushPendingWorkoutSession(
  sb: SupabaseClient,
  sessionId: string,
): Promise<boolean> {
  const setIds = Object.entries(read().sets)
    .filter(([, entry]) => entry.sessionId === sessionId)
    .map(([setId]) => setId);
  const setsSaved = await Promise.all(setIds.map((setId) => flushPendingSet(sb, setId)));
  if (setsSaved.some((saved) => !saved)) return false;

  const reorder = read().reorders[sessionId];
  if (!reorder) return true;
  try {
    await reorderSessionExercisesAndRoutine(sb, reorder.orderedIds);
    const pending = read();
    if (pending.reorders[sessionId]?.revision === reorder.revision) {
      delete pending.reorders[sessionId];
      write(pending);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

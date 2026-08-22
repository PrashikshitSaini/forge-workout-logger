"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { WeightUnit } from "@/lib/weight-units";

interface WeightUnitContextValue {
  weightUnit: WeightUnit;
  loading: boolean;
  setWeightUnit: (unit: WeightUnit) => Promise<void>;
}

const WeightUnitContext = createContext<WeightUnitContextValue | null>(null);

export function WeightUnitProvider({ children }: { children: React.ReactNode }) {
  const [weightUnit, setUnit] = useState<WeightUnit>("lb");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    void sb
      .from("user_preferences")
      .select("weight_unit")
      .maybeSingle()
      .then((result: { data: { weight_unit: string } | null; error: unknown }) => {
        if (!result.error && result.data?.weight_unit === "kg") setUnit("kg");
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<WeightUnitContextValue>(() => ({
    weightUnit,
    loading,
    setWeightUnit: async (unit) => {
      const sb = createSupabaseBrowserClient();
      const { data: { user }, error: userError } = await sb.auth.getUser();
      if (userError || !user) throw userError ?? new Error("Not signed in.");
      const previous = weightUnit;
      setUnit(unit);
      const { error } = await sb
        .from("user_preferences")
        .upsert({ user_id: user.id, weight_unit: unit, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) {
        setUnit(previous);
        throw error;
      }
    },
  }), [loading, weightUnit]);

  return <WeightUnitContext.Provider value={value}>{children}</WeightUnitContext.Provider>;
}

export function useWeightUnit(): WeightUnitContextValue {
  const value = useContext(WeightUnitContext);
  if (!value) throw new Error("useWeightUnit must be used inside WeightUnitProvider.");
  return value;
}

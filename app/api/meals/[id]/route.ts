import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NumberField = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  },
  z.number().min(0).max(100_000),
);

const ItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).nullable(),
  quantity: z.string().trim().min(1).max(120),
  calories: NumberField,
  protein_g: NumberField,
  carbs_g: NumberField,
  fat_g: NumberField,
  fiber_g: NumberField.nullable(),
});

const BodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  items: z.array(ItemSchema).min(1).max(30),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter valid meal values." }, { status: 400 });

  const { data: meal, error: mealError } = await supabase
    .from("meals")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (mealError) return NextResponse.json({ error: "Couldn't load that meal." }, { status: 400 });
  if (!meal) return NextResponse.json({ error: "Meal not found." }, { status: 404 });

  const { data: existingItems, error: itemsError } = await supabase
    .from("meal_items")
    .select("id")
    .eq("meal_id", id)
    .returns<{ id: string }[]>();
  if (itemsError) return NextResponse.json({ error: "Couldn't load meal items." }, { status: 400 });
  const existingIds = new Set((existingItems ?? []).map((item) => item.id));
  if (parsed.data.items.some((item) => !existingIds.has(item.id))) {
    return NextResponse.json({ error: "One or more meal items are invalid." }, { status: 400 });
  }

  const { error: updateMealError } = await supabase
    .from("meals")
    .update({ title: parsed.data.title })
    .eq("id", id);
  if (updateMealError) return NextResponse.json({ error: "Couldn't save the meal." }, { status: 400 });

  for (const item of parsed.data.items) {
    const { error } = await supabase
      .from("meal_items")
      .update({
        name: item.name,
        brand: item.brand?.trim() || null,
        quantity: item.quantity,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        fiber_g: item.fiber_g,
        confidence: "low",
      })
      .eq("id", item.id)
      .eq("meal_id", id);
    if (error) return NextResponse.json({ error: "Couldn't save all meal items." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

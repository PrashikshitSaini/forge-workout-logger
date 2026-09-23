import { NextResponse } from "next/server";
import { APP_NAME } from "@/lib/constants";
import { rateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MealItemSchema } from "@/lib/meal-analysis";
import {
  BarcodeSaveSchema,
  buildBarcodeMeal,
  normalizeBarcode,
  offLookupOutcome,
  parseBarcodeProduct,
} from "@/lib/barcode-food";

/**
 * Barcode meal logging.
 * GET  ?code=…  fixed-host Open Food Facts v2 lookup (live, no cache) → normalized product
 * POST          validates the reviewed label values, scales server-side, saves via create_meal
 */

const OFF_TIMEOUT_MS = 8_000;
const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
const OFF_FIELDS =
  "code,product_name,product_name_en,generic_name,brands,quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per,no_nutrition_data,nutriments";

function offUserAgent(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return `${APP_NAME}/0.1 (meal barcode lookup; ${site})`;
}

async function authenticate() {
  if (!isSupabaseConfigured()) {
    return { error: NextResponse.json({ error: "Not configured." }, { status: 503 }) };
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  return { supabase, user };
}

export async function GET(req: Request) {
  const auth = await authenticate();
  if (auth.error) return auth.error;

  const { ok, retryAfter } = rateLimit(`barcode:${auth.user.id}`, 30, 60_000);
  if (!ok) {
    return NextResponse.json(
      { error: "Give the barcode lookup a moment." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const code = normalizeBarcode(new URL(req.url).searchParams.get("code"));
  if (!code) {
    return NextResponse.json(
      { error: "Enter a valid UPC/EAN barcode (8, 12, 13, or 14 digits)." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${OFF_PRODUCT_URL}/${code}.json?fields=${OFF_FIELDS}`, {
      headers: { "User-Agent": offUserAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    const outcome = offLookupOutcome(response.status, payload);

    if (outcome === "not_found") {
      return NextResponse.json(
        { error: "No product found for that barcode. Try again, or describe this meal in words.", not_found: true },
        { status: 404 },
      );
    }
    if (outcome === "unavailable") {
      return NextResponse.json(
        { error: "Open Food Facts is unavailable right now. Try again in a moment." },
        { status: 502 },
      );
    }

    return NextResponse.json({ product: parseBarcodeProduct(code, payload) });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("Barcode lookup failed", err);
    return NextResponse.json(
      {
        error: timedOut
          ? "Open Food Facts took too long to answer. Try again."
          : "Couldn't reach Open Food Facts. Check your connection and try again.",
      },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await authenticate();
  if (auth.error) return auth.error;

  const { ok, retryAfter } = rateLimit(`barcode-save:${auth.user.id}`, 20, 60_000);
  if (!ok) {
    return NextResponse.json(
      { error: "Give the meal log a moment." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const parsed = BarcodeSaveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Review the product values, amount eaten, and date before saving." },
      { status: 400 },
    );
  }

  let draft;
  try {
    draft = buildBarcodeMeal(parsed.data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Review the product values and amount eaten." },
      { status: 400 },
    );
  }

  // Reuse the shared item contract so barcode saves match conversational ones.
  const item = MealItemSchema.safeParse(draft.item);
  if (!item.success) {
    return NextResponse.json({ error: "These nutrition values are out of range." }, { status: 400 });
  }

  try {
    const { data: mealId, error } = await auth.supabase.rpc("create_meal", {
      p_logged_on: parsed.data.logged_on,
      p_meal_type: "meal",
      p_title: draft.title,
      p_original_input: `Scanned barcode ${draft.barcode}: ${draft.title}`,
      p_assumptions: draft.assumptions,
      p_items: [item.data],
    });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      meal_id: mealId as string,
      title: draft.title,
      totals: {
        calories: draft.nutrition.calories,
        protein_g: draft.nutrition.protein_g,
        carbs_g: draft.nutrition.carbs_g,
        fat_g: draft.nutrition.fat_g,
      },
    });
  } catch (err) {
    console.error("Barcode meal save failed", err);
    const message = err instanceof Error ? err.message : "";
    const missingMigration = /create_meal|schema cache/i.test(message);
    return NextResponse.json(
      {
        error: missingMigration
          ? "Meal storage is not ready. Apply migration 0005 first."
          : "Couldn't save that meal. Try again.",
      },
      { status: 502 },
    );
  }
}

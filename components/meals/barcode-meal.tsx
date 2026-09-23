"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, ExternalLink, Keyboard, Loader2, ScanBarcode, X } from "lucide-react";
import type { BarcodeProduct } from "@/lib/barcode-food";
import {
  availableModes,
  canSaveDraft,
  draftFromProduct,
  draftMissingRequired,
  draftTotals,
  draftToSavePayload,
  MACRO_LABELS,
  numberOrNull,
  quantityForAmount,
  resolveBasis,
  setBasisMode,
  setPieceName,
  type BarcodeDraft,
  type BasisMode,
  type NutritionFields,
} from "@/lib/barcode-food";
import { startBarcodeScan, type DetectorCtor, type ReaderLike, type ScanDeps } from "@/lib/barcode-camera";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Phase = "idle" | "scanning" | "loading" | "preview";

const MACRO_INPUTS = [
  ["calories", "Calories"],
  ["protein", "Protein"],
  ["carbs", "Carbs"],
  ["fat", "Fat"],
  ["fiber", "Fiber"],
] as const satisfies ReadonlyArray<readonly [keyof NutritionFields, string]>;

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was blocked. Allow camera access, or type the barcode digits.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No usable camera was found. Type the barcode digits instead.";
  }
  return "Couldn't start the camera. Type the barcode digits instead.";
}

/** Native BarcodeDetector on Chrome/Android, ZXing (UPC/EAN only) on iOS Safari. */
function browserScanDeps(): ScanDeps {
  const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return {
    requestStream: () =>
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      }),
    DetectorCtor: Detector,
    getSupportedFormats: Detector?.getSupportedFormats?.bind(Detector),
    loadReader: async (): Promise<ReaderLike> => {
      const { BrowserMultiFormatReader, BarcodeFormat } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      reader.possibleFormats = [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ];
      return reader as unknown as ReaderLike;
    },
  };
}

export function BarcodeMeal({
  loggedOn,
  onSaved,
}: {
  loggedOn: string;
  onSaved: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const [draft, setDraft] = useState<BarcodeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perUnit, setPerUnit] = useState("");
  const [units, setUnits] = useState("");
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopCameraRef = useRef<(() => void) | null>(null);
  const scannerAbortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(0);
  const handlingRef = useRef(false);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);

  const releaseCamera = useCallback(() => {
    scannerAbortRef.current?.abort();
    scannerAbortRef.current = null;
    stopCameraRef.current?.();
    stopCameraRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCamera();
    };
  }, [releaseCamera]);

  const reset = useCallback(() => {
    sessionRef.current += 1;
    releaseCamera();
    setPhase("idle");
    setError(null);
    setDraft(null);
    setCode("");
    setPerUnit("");
    setUnits("");
  }, [releaseCamera]);

  const handleCode = useCallback(
    async (raw: string) => {
      if (handlingRef.current) return;
      handlingRef.current = true;
      const session = sessionRef.current + 1;
      sessionRef.current = session;
      // Invalidate the running scanner and release the camera first.
      releaseCamera();
      setPhase("loading");
      setError(null);
      try {
        const cleaned = raw.replace(/\D/g, "");
        const response = await fetch(`/api/meals/barcode?code=${encodeURIComponent(cleaned)}`);
        const json = (await response.json().catch(() => ({}))) as {
          product?: BarcodeProduct;
          error?: string;
        };
        if (!mountedRef.current || sessionRef.current !== session) return;
        if (!response.ok || !json.product) {
          setError(json.error || "Couldn't look up that barcode.");
          setPhase("idle");
          return;
        }
        const next = draftFromProduct(json.product);
        setDraft(next);
        setCode(next.barcode);
        setPerUnit("");
        setUnits("");
        setPhase("preview");
      } catch {
        if (mountedRef.current && sessionRef.current === session) {
          setError("Couldn't reach the barcode lookup. Check your connection and try again.");
          setPhase("idle");
        }
      } finally {
        handlingRef.current = false;
      }
    },
    [releaseCamera],
  );

  async function startCamera() {
    const video = videoRef.current;
    if (!video) {
      setError("Camera view is not ready. Try again, or type the barcode digits.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera. Type the barcode digits instead.");
      return;
    }

    const session = sessionRef.current + 1;
    sessionRef.current = session;
    const controller = new AbortController();
    scannerAbortRef.current?.abort();
    scannerAbortRef.current = controller;
    setPhase("scanning");
    setError(null);

    try {
      const stop = await startBarcodeScan(
        video,
        (value) => {
          // Only the current session may act on a decode; a stale scanner cannot.
          if (sessionRef.current !== session || !mountedRef.current) return;
          void handleCode(value);
        },
        {
          ...browserScanDeps(),
          onError: (err) => {
            if (sessionRef.current !== session || !mountedRef.current) return;
            stopCameraRef.current = null;
            setPhase("idle");
            setError(cameraErrorMessage(err));
          },
        },
        controller.signal,
      );
      // Cancelled while the camera or the reader was starting: release it now.
      if (!mountedRef.current || sessionRef.current !== session) {
        stop();
        return;
      }
      stopCameraRef.current = stop;
    } catch (err) {
      if (controller.signal.aborted) return; // user cancelled; nothing to report
      if (!mountedRef.current || sessionRef.current !== session) return;
      setPhase("idle");
      setError(cameraErrorMessage(err));
    }
  }

  function cancelScan() {
    sessionRef.current += 1;
    releaseCamera();
    setPhase("idle");
  }

  function applyWeighedPieceHelper() {
    if (!draft) return;
    const unit = basis?.unit === "ml" ? "ml" : "g";
    const per = numberOrNull(perUnit);
    const count = numberOrNull(units);
    if (!per || !count || per <= 0 || count <= 0) {
      setError(`Enter the ${unit === "ml" ? "volume" : "weight"} of one piece in ${unit} and how many you ate.`);
      return;
    }
    const total = Math.round(per * count * 100) / 100;
    setDraft({ ...draft, amount: String(total), quantity: `${count} × ${per} ${unit}` });
    setError(null);
  }

  const basis = draft ? resolveBasis(draft) : null;
  const scaled = draft ? draftTotals(draft) : null;
  const amountNumber = draft ? numberOrNull(draft.amount) : null;
  const missingRequired = draft ? draftMissingRequired(draft) : [];
  const canSave = draft ? canSaveDraft(draft, loggedOn) : false;

  async function save() {
    if (!draft || !canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/meals/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToSavePayload(draft, loggedOn)),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string; title?: string };
      if (!response.ok) throw new Error(json.error || "Couldn't save this meal.");
      toast(`${json.title || draft.name} logged.`, "success");
      reset();
      await onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save this meal.", "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-accent/30 bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ScanBarcode size={17} className="text-accent" />
        Barcode meal
      </div>

      {phase === "preview" && draft && basis ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {draft.name}
                {draft.brand ? <span className="text-muted"> · {draft.brand}</span> : null}
              </p>
              <a
                href={draft.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                {draft.sourceTitle} <ExternalLink size={10} />
              </a>
              {draft.note ? <p className="mt-1 text-xs text-warning">{draft.note}</p> : null}
            </div>
            <Button variant="ghost" size="icon" aria-label="Discard barcode scan" onClick={reset} disabled={saving}>
              <X size={16} />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[10px] uppercase tracking-wide text-muted">
              Product
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="h-9 text-sm"
                disabled={saving}
              />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wide text-muted">
              Brand
              <Input
                value={draft.brand}
                onChange={(event) => setDraft({ ...draft, brand: event.target.value })}
                className="h-9 text-sm"
                disabled={saving}
              />
            </label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="barcode-basis">Nutrition basis</Label>
            <Select
              id="barcode-basis"
              value={draft.mode}
              className="h-9 text-sm"
              disabled={saving}
              onChange={(event) =>
                setDraft((current) =>
                  current ? setBasisMode(current, event.target.value as BasisMode) : current,
                )
              }
            >
              {availableModes(draft).map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "serving"
                    ? `Label serving (${draft.servingText ?? "1 serving"})`
                    : mode === "piece"
                      ? "Per piece (label values per piece)"
                      : draft.productBasis === "serving"
                        ? draft.productBasisLabel
                        : `Per 100 ${draft.productBasis === "100ml" ? "ml" : "g"}`}
                </option>
              ))}
            </Select>
            {draft.mode === "piece" ? (
              <label className="block space-y-1 text-[10px] uppercase tracking-wide text-muted">
                Piece name (e.g. slice)
                <Input
                  value={draft.pieceName}
                  onChange={(event) =>
                    setDraft((current) => (current ? setPieceName(current, event.target.value) : current))
                  }
                  className="h-9 text-sm"
                  disabled={saving}
                />
              </label>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {draft.mode === "piece"
                ? `Enter the nutrition printed for one ${draft.pieceName || "piece"} — per-100 values do not apply here.`
                : `The values below are for ${basis.label}.`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {MACRO_INPUTS.map(([field, label]) => {
              const value = draft.nutrition[field];
              return (
                <label key={field} className="space-y-1 text-[10px] uppercase tracking-wide text-muted">
                  {label}
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    value={value}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        nutrition: { ...draft.nutrition, [field]: event.target.value },
                      })
                    }
                    className={cn("h-9 text-sm", value.trim() === "" && field !== "fiber" && "border-warning/60")}
                  />
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <label className="space-y-1 text-[10px] uppercase tracking-wide text-muted">
              Amount eaten ({basis.unitLabel})
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={draft.amount}
                disabled={saving}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    amount: event.target.value,
                    quantity: quantityForAmount(draft, event.target.value),
                  })
                }
                className={cn("h-9 text-sm", !(amountNumber !== null && amountNumber > 0) && "border-warning/60")}
              />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wide text-muted">
              Quantity (as logged)
              <Input
                value={draft.quantity}
                disabled={saving}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
                className="h-9 text-sm"
              />
            </label>
          </div>

          {draft.mode === "label" && (basis.unit === "g" || basis.unit === "ml") ? (
            <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-muted-foreground">
                Label only gives per 100 {basis.unit}? {basis.unit === "ml" ? "Measure" : "Weigh"} one piece, then say
                how many you ate.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-[10px] uppercase tracking-wide text-muted">
                  One piece {basis.unit === "ml" ? "measures" : "weighs"} ({basis.unit})
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    value={perUnit}
                    disabled={saving}
                    onChange={(event) => setPerUnit(event.target.value)}
                    className="h-9 text-sm"
                  />
                </label>
                <label className="space-y-1 text-[10px] uppercase tracking-wide text-muted">
                  Pieces eaten
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    inputMode="decimal"
                    value={units}
                    disabled={saving}
                    onChange={(event) => setUnits(event.target.value)}
                    className="h-9 text-sm"
                  />
                </label>
              </div>
              <Button size="sm" variant="secondary" onClick={applyWeighedPieceHelper} disabled={saving}>
                Use this amount
              </Button>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
            <p className="font-medium">Will log</p>
            <p className="tabular mt-1 text-sm">
              {scaled?.calories ?? "—"} cal · P {scaled?.protein_g ?? "—"} · C {scaled?.carbs_g ?? "—"} · F {scaled?.fat_g ?? "—"}
              {scaled?.fiber_g != null ? ` · Fiber ${scaled.fiber_g}` : ""}
            </p>
            <p className="mt-1 text-muted-foreground">
              {amountNumber ?? "—"} {basis.unitLabel} from {basis.label} · saved to {loggedOn}
            </p>
          </div>

          {missingRequired.length ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Open Food Facts left {missingRequired.map((key) => MACRO_LABELS[key]).join(", ")} blank. Fill them from the
              label — missing is not the same as zero.
            </p>
          ) : null}

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={reset} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!canSave || saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save meal
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Scan the UPC/EAN printed on a packaged product, or type the number in from the label. You confirm the values
            and portion before saving.
          </p>

          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Barcode camera preview"
            className={cn(
              "rounded-lg bg-black object-cover",
              phase === "scanning" ? "aspect-square w-full" : "h-0 w-0 opacity-0",
            )}
          />

          {phase === "scanning" ? (
            <Button variant="secondary" className="w-full" onClick={cancelScan}>
              <Camera size={16} /> Cancel scan
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => void startCamera()}
              disabled={phase === "loading" || saving}
            >
              <Camera size={16} /> Use camera
            </Button>
          )}

          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim()) void handleCode(code);
            }}
          >
            <Label htmlFor="barcode-code">Barcode digits</Label>
            <div className="flex gap-2">
              <Input
                id="barcode-code"
                value={code}
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 3017620422003"
                onChange={(event) => setCode(event.target.value)}
                className="h-9 text-sm"
                disabled={phase === "loading"}
              />
              <Button type="submit" size="sm" disabled={!code.trim() || phase === "loading"}>
                {phase === "loading" ? <Loader2 size={15} className="animate-spin" /> : <Keyboard size={15} />} Look up
              </Button>
            </div>
          </form>

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

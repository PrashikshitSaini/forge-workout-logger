/**
 * Barcode camera lifecycle. DOM-shaped but dependency-injected, so the release
 * paths (startup failure, cancellation, unmount, late resolve) are unit-testable
 * without a browser.
 *
 * Guarantees:
 * - the stream is released on every failure, cancellation and late async resolve;
 * - a cancelled scan never calls `onCode` (the callback checks the live token);
 * - native `BarcodeDetector` is only used when it advertises UPC/EAN support,
 *   otherwise ZXing takes over with those formats only (no QR digit extraction).
 */

export const UPC_EAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

export interface TrackLike {
  stop(): void;
}
export interface StreamLike {
  getTracks(): TrackLike[];
}
export interface VideoLike {
  srcObject: unknown;
  play(): Promise<void>;
}
export interface DetectedCode {
  rawValue?: string;
}
export interface DetectorLike {
  detect(source: VideoLike): Promise<DetectedCode[]>;
}
export interface DetectorCtor {
  new (options?: { formats?: string[] }): DetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}
export interface ReaderControls {
  stop(): void;
}
export interface ReaderResult {
  getText(): string;
}
export interface ReaderLike {
  decodeFromStream(
    stream: StreamLike,
    video: VideoLike,
    onResult: (result: ReaderResult | null) => void,
  ): Promise<ReaderControls>;
}

export interface ScanDeps {
  requestStream(): Promise<StreamLike>;
  DetectorCtor?: DetectorCtor;
  getSupportedFormats?(): Promise<string[]>;
  loadReader(): Promise<ReaderLike>;
  decodeIntervalMs?: number;
  maxDecodeFailures?: number;
  onError?(err: unknown): void;
}

const DEFAULT_DECODE_INTERVAL_MS = 250;
const DEFAULT_MAX_DECODE_FAILURES = 10;

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Native formats to use, or null when the detector is absent/unsupported → ZXing. */
async function probeNativeFormats(deps: ScanDeps): Promise<string[] | null> {
  if (!deps.getSupportedFormats) return [...UPC_EAN_FORMATS];
  let supported: string[];
  try {
    supported = await deps.getSupportedFormats();
  } catch {
    return [...UPC_EAN_FORMATS]; // probing unavailable: trust the defaults
  }
  if (!supported.length) return null; // [] means "nothing supported" → ZXing
  const usable = UPC_EAN_FORMATS.filter((format) => supported.includes(format));
  return usable.length ? usable : null;
}

/**
 * Start scanning `video` for a UPC/EAN. Resolves with an idempotent `stop()`.
 * The pending initialisation rejects with an `AbortError` if `signal` aborts.
 */
export async function startBarcodeScan(
  video: VideoLike,
  onCode: (value: string) => void,
  deps: ScanDeps,
  signal?: AbortSignal,
): Promise<() => void> {
  const stream = await deps.requestStream();
  const interval = deps.decodeIntervalMs ?? DEFAULT_DECODE_INTERVAL_MS;
  const maxFailures = deps.maxDecodeFailures ?? DEFAULT_MAX_DECODE_FAILURES;

  let stopped = false;
  let stopDetector: (() => void) | null = null;
  let stopReader: (() => void) | null = null;

  const abortError = () =>
    typeof DOMException === "function"
      ? new DOMException("Barcode scan aborted", "AbortError")
      : Object.assign(new Error("Barcode scan aborted"), { name: "AbortError" });

  const release = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener("abort", onAbort);
    stopDetector?.();
    stopReader?.();
    for (const track of stream.getTracks()) track.stop();
    if (video.srcObject === stream) video.srcObject = null;
  };
  const onAbort = () => release();

  // Late resolve after the caller cancelled: stop immediately, never play.
  if (signal?.aborted) {
    release();
    throw abortError();
  }
  signal?.addEventListener("abort", onAbort, { once: true });

  const runZxing = async () => {
    const reader = await deps.loadReader();
    if (stopped || signal?.aborted) throw abortError();
    const controls = await reader.decodeFromStream(stream, video, (result) => {
      if (stopped || signal?.aborted) return;
      if (result) onCode(result.getText());
    });
    stopReader = () => controls.stop();
    if (stopped || signal?.aborted) {
      controls.stop();
      throw abortError();
    }
  };

  try {
    video.srcObject = stream;
    await video.play();
    if (stopped || signal?.aborted) throw abortError();

    if (deps.DetectorCtor) {
      const formats = await probeNativeFormats(deps);
      if (formats) {
        let detector: DetectorLike | null = null;
        try {
          detector = new deps.DetectorCtor({ formats });
        } catch {
          detector = null; // constructor rejected: fall back to ZXing safely
        }
        if (detector) {
          let cancelled = false;
          let timer: ReturnType<typeof setTimeout> | null = null;
          let failures = 0;
          const tick = async () => {
            if (cancelled || stopped || signal?.aborted) return;
            try {
              const results = await detector!.detect(video);
              failures = 0;
              const value = results[0]?.rawValue;
              if (!cancelled && !stopped && value) {
                cancelled = true;
                onCode(String(value));
                return;
              }
            } catch {
              failures += 1;
              if (failures >= maxFailures) {
                // A detector that keeps rejecting is unusable: hand over to ZXing once.
                cancelled = true;
                void runZxing().catch((err) => {
                  if (stopped) return;
                  // Release first: onError drops the caller's stop handle, so the
                  // stream would otherwise stay live until a manual cancel.
                  release();
                  deps.onError?.(err);
                });
                return;
              }
            }
            if (!cancelled && !stopped && !signal?.aborted) {
              timer = setTimeout(() => void tick(), interval);
            }
          };
          stopDetector = () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
          };
          timer = setTimeout(() => void tick(), interval);
          return release;
        }
      }
    }

    await runZxing();
    return release;
  } catch (err) {
    release();
    throw err;
  }
}

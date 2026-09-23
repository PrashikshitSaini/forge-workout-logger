import assert from "node:assert/strict";
import test from "node:test";
import { isAbortError, startBarcodeScan, UPC_EAN_FORMATS } from "../lib/barcode-camera.ts";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeStream() {
  const tracks = [
    { stopped: false, stop() { this.stopped = true; } },
    { stopped: false, stop() { this.stopped = true; } },
  ];
  return {
    tracks,
    getTracks: () => tracks,
    allStopped: () => tracks.every((track) => track.stopped),
  };
}

function makeVideo() {
  return {
    srcObject: null,
    plays: 0,
    async play() {
      this.plays += 1;
    },
  };
}

function zxingReader(register) {
  return {
    async decodeFromStream(stream, video, onResult) {
      const controls = { stopped: false, stop() { this.stopped = true; } };
      register?.({ stream, video, onResult, controls });
      return controls;
    },
  };
}

test("UPC_EAN_FORMATS covers the four retail symbologies and excludes 2D codes", () => {
  assert.deepEqual([...UPC_EAN_FORMATS], ["ean_13", "ean_8", "upc_a", "upc_e"]);
});

test("startBarcodeScan plays the stream and stop() releases tracks and reader", async () => {
  const stream = makeStream();
  const video = makeVideo();
  let controls = null;
  const stop = await startBarcodeScan(video, () => {}, {
    requestStream: async () => stream,
    loadReader: async () =>
      zxingReader(({ controls: c }) => {
        controls = c;
      }),
  });

  assert.equal(video.srcObject, stream);
  assert.equal(video.plays, 1);
  assert.ok(controls);

  stop();
  assert.ok(stream.allStopped());
  assert.equal(video.srcObject, null);
  assert.equal(controls.stopped, true);

  stop(); // idempotent
  assert.ok(stream.allStopped());
});

test("a late stream after cancellation is stopped without ever playing", async () => {
  const stream = makeStream();
  const video = makeVideo();
  const controller = new AbortController();
  let resolveStream;
  const pending = new Promise((resolve) => {
    resolveStream = resolve;
  });

  const scan = startBarcodeScan(
    video,
    () => {},
    {
      requestStream: () => pending,
      loadReader: async () => {
        throw new Error("reader must not load");
      },
    },
    controller.signal,
  );

  controller.abort();
  resolveStream(stream);

  await assert.rejects(scan, (err) => isAbortError(err));
  assert.ok(stream.allStopped());
  assert.equal(video.plays, 0);
  assert.equal(video.srcObject, null);
});

test("a getUserMedia rejection propagates without playing", async () => {
  const video = makeVideo();
  await assert.rejects(
    startBarcodeScan(video, () => {}, {
      requestStream: async () => {
        const err = new Error("Permission denied");
        err.name = "NotAllowedError";
        throw err;
      },
      loadReader: async () => {
        throw new Error("reader must not load");
      },
    }),
    /Permission denied/,
  );
  assert.equal(video.plays, 0);
});

test("a native detector that rejects construction falls back to ZXing", async () => {
  const stream = makeStream();
  const video = makeVideo();
  let readerUsed = false;
  const stop = await startBarcodeScan(video, () => {}, {
    requestStream: async () => stream,
    DetectorCtor: function UnsupportedDetector() {
      throw new Error("unsupported");
    },
    getSupportedFormats: async () => ["ean_13", "upc_a"],
    loadReader: async () => {
      readerUsed = true;
      return zxingReader();
    },
  });

  assert.equal(readerUsed, true);
  stop();
  assert.ok(stream.allStopped());
});

test("getSupportedFormats returning [] falls back to ZXing", async () => {
  const stream = makeStream();
  const video = makeVideo();
  let readerUsed = false;
  const stop = await startBarcodeScan(video, () => {}, {
    requestStream: async () => stream,
    DetectorCtor: function Detector() {
      return { async detect() { return []; } };
    },
    getSupportedFormats: async () => [],
    loadReader: async () => {
      readerUsed = true;
      return zxingReader();
    },
  });

  assert.equal(readerUsed, true);
  stop();
});

test("a native detector without UPC/EAN support falls back to ZXing", async () => {
  const stream = makeStream();
  const video = makeVideo();
  let readerUsed = false;
  const stop = await startBarcodeScan(video, () => {}, {
    requestStream: async () => stream,
    DetectorCtor: function Detector() {
      return { async detect() { return []; } };
    },
    getSupportedFormats: async () => ["qr_code", "data_matrix"],
    loadReader: async () => {
      readerUsed = true;
      return zxingReader();
    },
  });

  assert.equal(readerUsed, true);
  stop();
});

test("the native detector is used with the advertised UPC/EAN formats when supported", async () => {
  const stream = makeStream();
  const video = makeVideo();
  let detector = null;
  let readerUsed = false;
  const stop = await startBarcodeScan(video, () => {}, {
    requestStream: async () => stream,
    DetectorCtor: function Detector(options) {
      detector = { options, async detect() { return []; } };
      return detector;
    },
    getSupportedFormats: async () => ["ean_13"],
    loadReader: async () => {
      readerUsed = true;
      return zxingReader();
    },
    decodeIntervalMs: 1,
  });

  assert.deepEqual(detector.options.formats, ["ean_13"]);
  assert.equal(readerUsed, false);
  stop();
  assert.ok(stream.allStopped());
});

test("a native decode reports the code once and stops looping", async () => {
  const stream = makeStream();
  const video = makeVideo();
  const codes = [];
  let detections = 0;
  const stop = await startBarcodeScan(video, (value) => codes.push(value), {
    requestStream: async () => stream,
    DetectorCtor: function Detector() {
      return {
        async detect() {
          detections += 1;
          return [{ rawValue: "012345678905" }];
        },
      };
    },
    getSupportedFormats: async () => ["upc_a"],
    loadReader: async () => {
      throw new Error("reader must not load");
    },
    decodeIntervalMs: 1,
  });

  await wait(20);
  assert.deepEqual(codes, ["012345678905"]);
  assert.equal(detections, 1);
  stop();
});

test("the ZXing callback is ignored once the scan is stopped", async () => {
  const stream = makeStream();
  const video = makeVideo();
  const codes = [];
  let emit = null;
  const stop = await startBarcodeScan(video, (value) => codes.push(value), {
    requestStream: async () => stream,
    loadReader: async () =>
      zxingReader(({ onResult }) => {
        emit = onResult;
      }),
  });

  assert.ok(emit);
  stop();
  emit({ getText: () => "012345678905" });
  assert.deepEqual(codes, []);
});

test("a detector that keeps failing hands over to ZXing", async () => {
  const stream = makeStream();
  const video = makeVideo();
  let readerUsed = false;
  const stop = await startBarcodeScan(video, () => {}, {
    requestStream: async () => stream,
    DetectorCtor: function Detector() {
      return {
        async detect() {
          throw new Error("unreadable frame");
        },
      };
    },
    getSupportedFormats: async () => ["upc_a"],
    maxDecodeFailures: 2,
    decodeIntervalMs: 1,
    loadReader: async () => {
      readerUsed = true;
      return zxingReader();
    },
  });

  await wait(40);
  assert.equal(readerUsed, true);
  stop();
  assert.ok(stream.allStopped());
});

test("a failed ZXing handover releases the stream before reporting the error", async () => {
  const stream = makeStream();
  const video = makeVideo();
  const errors = [];
  await startBarcodeScan(
    video,
    () => {},
    {
      requestStream: async () => stream,
      DetectorCtor: function Detector() {
        return {
          async detect() {
            throw new Error("unreadable frame");
          },
        };
      },
      getSupportedFormats: async () => ["upc_a"],
      maxDecodeFailures: 2,
      decodeIntervalMs: 1,
      loadReader: async () => {
        throw new Error("reader import failed");
      },
      onError: (err) => errors.push(err),
    },
  );

  await wait(50);
  assert.equal(errors.length, 1, "reports the handover failure once");
  assert.match(errors[0].message, /reader import failed/);
  assert.ok(stream.allStopped(), "stream released before onError, not stranded until cancel");
  assert.equal(video.srcObject, null);
});

test("a ZXing startup failure releases the stream", async () => {
  const stream = makeStream();
  const video = makeVideo();
  await assert.rejects(
    startBarcodeScan(video, () => {}, {
      requestStream: async () => stream,
      loadReader: async () => {
        throw new Error("import failed");
      },
    }),
    /import failed/,
  );
  assert.ok(stream.allStopped());
  assert.equal(video.srcObject, null);
});

test("aborting after startup releases the stream and the reader", async () => {
  const stream = makeStream();
  const video = makeVideo();
  const controller = new AbortController();
  let controls = null;
  await startBarcodeScan(
    video,
    () => {},
    {
      requestStream: async () => stream,
      loadReader: async () =>
        zxingReader(({ controls: c }) => {
          controls = c;
        }),
    },
    controller.signal,
  );

  controller.abort();
  assert.ok(stream.allStopped());
  assert.equal(controls.stopped, true);
  assert.equal(video.srcObject, null);
});

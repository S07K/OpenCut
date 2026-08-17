import { describe, expect, it } from "vitest";
import { classifyFile, extensionOf, formatByteSize } from "../mime";
import { computePeaks, deserializeWaveform, mixToMono, serializeWaveform } from "../waveform";
import { MemoryMediaStore } from "../storage";
import { assetDurationInFrames, DEFAULT_STILL_DURATION_SECONDS } from "../import";
import { collectGarbage } from "../gc";
import type { MediaAsset } from "@cutaway/types";

describe("classifyFile", () => {
  it("classifies by MIME type", () => {
    expect(classifyFile("a.mp4", "video/mp4")).toBe("video");
    expect(classifyFile("a.mp3", "audio/mpeg")).toBe("audio");
    expect(classifyFile("a.png", "image/png")).toBe("image");
  });

  it("treats GIF as its own kind, not as an image", () => {
    // GIFs are animated and behave like video on the timeline, so folding them
    // into "image" would drop their animation.
    expect(classifyFile("a.gif", "image/gif")).toBe("gif");
  });

  it("falls back to the extension when the browser reports no MIME type", () => {
    // Drag-and-drop from some file managers, and .mkv generally, yield "".
    expect(classifyFile("clip.mkv", "")).toBe("video");
    expect(classifyFile("song.flac", "")).toBe("audio");
    expect(classifyFile("SHOT.MOV", "")).toBe("video");
  });

  it("returns null for unrecognized files rather than guessing", () => {
    expect(classifyFile("notes.txt", "text/plain")).toBeNull();
    expect(classifyFile("archive.zip", "")).toBeNull();
    expect(classifyFile("noextension", "")).toBeNull();
  });
});

describe("extensionOf", () => {
  it("lowercases and handles dotted names", () => {
    expect(extensionOf("My.Final.CUT.MP4")).toBe("mp4");
    expect(extensionOf("plain")).toBe("");
  });
});

describe("formatByteSize", () => {
  it("scales to a readable unit", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(2048)).toBe("2.0 KB");
    expect(formatByteSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatByteSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
});

describe("computePeaks", () => {
  it("produces exactly the requested number of buckets", () => {
    const samples = new Float32Array(10_000).map((_, index) => Math.sin(index));
    expect(computePeaks(samples, 256).min).toHaveLength(256);
    expect(computePeaks(samples, 256).max).toHaveLength(256);
  });

  it("captures min and max separately, preserving asymmetry", () => {
    const samples = Float32Array.from([0.1, 0.9, -0.4, 0.2]);
    const peaks = computePeaks(samples, 1);

    expect(peaks.max[0]).toBeCloseTo(0.9);
    expect(peaks.min[0]).toBeCloseTo(-0.4);
  });

  it("preserves transients instead of averaging them away", () => {
    // One loud sample in a thousand quiet ones — a drum hit. Averaging would
    // erase it; peak downsampling must not.
    const samples = new Float32Array(1000);
    samples[500] = 1;

    const peaks = computePeaks(samples, 10);
    expect(Math.max(...peaks.max)).toBe(1);
  });

  it("never leaves an empty bucket when data exists", () => {
    // More buckets than samples: naive bucketing yields empty ranges here,
    // which would render as gaps in continuous audio.
    const samples = Float32Array.from([0.5, -0.5]);
    const peaks = computePeaks(samples, 8);

    expect(peaks.min).toHaveLength(8);
    expect(peaks.max.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("handles empty input without throwing", () => {
    const peaks = computePeaks(new Float32Array(0), 16);
    expect(peaks.resolution).toBe(16);
    expect(Array.from(peaks.max)).toEqual(new Array(16).fill(0));
  });
});

describe("mixToMono", () => {
  it("averages channels", () => {
    const left = Float32Array.from([1, 0]);
    const right = Float32Array.from([0, 1]);

    expect(Array.from(mixToMono([left, right]))).toEqual([0.5, 0.5]);
  });

  it("returns the single channel untouched", () => {
    const mono = Float32Array.from([0.3, 0.7]);
    expect(mixToMono([mono])).toBe(mono);
  });

  it("handles no channels", () => {
    expect(mixToMono([])).toHaveLength(0);
  });
});

describe("waveform serialization", () => {
  it("round-trips through JSON", () => {
    const original = computePeaks(Float32Array.from([0.2, -0.6, 0.9, -0.1, 0.4]), 4);
    const restored = deserializeWaveform(JSON.parse(JSON.stringify(serializeWaveform(original))));

    expect(Array.from(restored.min)).toEqual(Array.from(original.min));
    expect(Array.from(restored.max)).toEqual(Array.from(original.max));
    expect(restored.resolution).toBe(original.resolution);
  });
});

describe("MemoryMediaStore", () => {
  it("stores, retrieves, and deletes blobs", async () => {
    const store = new MemoryMediaStore();
    const blob = new Blob(["hello"]);

    await store.put("a", blob);
    expect(await store.get("a")).toBe(blob);
    expect(await store.keys()).toEqual(["a"]);

    await store.delete("a");
    expect(await store.get("a")).toBeNull();
  });

  it("returns null for a missing key", async () => {
    expect(await new MemoryMediaStore().get("nope")).toBeNull();
  });
});

describe("assetDurationInFrames", () => {
  const asset = (durationSeconds: number): MediaAsset => ({
    id: "m1",
    name: "test",
    kind: "video",
    mimeType: "video/mp4",
    source: { type: "indexeddb", key: "k" },
    metadata: {
      durationSeconds,
      frameRate: null,
      dimensions: null,
      hasAudio: false,
      hasVideo: true,
      codec: null,
      sampleRate: null,
      channels: null,
      byteSize: 0,
    },
    thumbnailKey: null,
    waveformKey: null,
    importedAt: 0,
  });

  it("converts duration using the project frame rate", () => {
    expect(assetDurationInFrames(asset(2), 30)).toBe(60);
    expect(assetDurationInFrames(asset(2), 60)).toBe(120);
  });

  it("gives stills a default duration instead of zero", () => {
    // A zero-length clip cannot be seen or grabbed on the timeline.
    expect(assetDurationInFrames(asset(0), 30)).toBe(DEFAULT_STILL_DURATION_SECONDS * 30);
  });

  it("never returns a zero-length clip", () => {
    expect(assetDurationInFrames(asset(0.001), 30)).toBeGreaterThanOrEqual(1);
  });
});

describe("collectGarbage", () => {
  async function seeded() {
    const store = new MemoryMediaStore();
    await store.put("keep:source", new Blob(["aaaa"]));
    await store.put("keep:thumb", new Blob(["bb"]));
    await store.put("orphan:source", new Blob(["cccccc"]));
    await store.put("orphan:thumb", new Blob(["d"]));
    return store;
  }

  it("deletes only unreferenced blobs", async () => {
    const store = await seeded();
    const result = await collectGarbage(store, new Set(["keep:source", "keep:thumb"]));

    expect(result.deletedKeys.sort()).toEqual(["orphan:source", "orphan:thumb"]);
    expect((await store.keys()).sort()).toEqual(["keep:source", "keep:thumb"]);
    expect(result.keptCount).toBe(2);
  });

  it("reports the bytes reclaimed", async () => {
    const store = await seeded();
    const result = await collectGarbage(store, new Set(["keep:source", "keep:thumb"]));
    expect(result.bytesFreed).toBe(7);
  });

  it("deletes everything when nothing is referenced", async () => {
    const store = await seeded();
    await collectGarbage(store, new Set());
    expect(await store.keys()).toEqual([]);
  });

  it("keeps everything when all keys are referenced", async () => {
    const store = await seeded();
    const keys = await store.keys();
    const result = await collectGarbage(store, new Set(keys));

    expect(result.deletedKeys).toEqual([]);
    expect(await store.keys()).toHaveLength(4);
  });

  it("is a no-op on an empty store", async () => {
    const result = await collectGarbage(new MemoryMediaStore(), new Set(["x"]));
    expect(result.deletedKeys).toEqual([]);
    expect(result.bytesFreed).toBe(0);
  });
});

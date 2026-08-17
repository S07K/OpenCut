import { describe, expect, it } from "vitest";
import type { VideoContent } from "@cutaway/types";
import {
  computeDuration,
  moveClip,
  rippleDelete,
  rippleInsert,
  splitClip,
  trimClipEnd,
  trimClipStart,
} from "../operations";
import { makeClip } from "./fixtures";

describe("splitClip", () => {
  it("splits into two adjacent halves with no gap or overlap", () => {
    const clip = makeClip({ startFrame: 10, durationFrames: 100 });
    const result = splitClip(clip, 60, "clip-2");

    expect(result).not.toBeNull();
    const [left, right] = result!;

    expect(left.startFrame).toBe(10);
    expect(left.durationFrames).toBe(50);
    expect(right.startFrame).toBe(60);
    expect(right.durationFrames).toBe(50);
    // The defining property: the halves exactly tile the original.
    expect(left.startFrame + left.durationFrames).toBe(right.startFrame);
    expect(right.startFrame + right.durationFrames).toBe(110);
  });

  it("advances the source in-point of the right half", () => {
    const clip = makeClip({ startFrame: 0, durationFrames: 100 });
    const [, right] = splitClip(clip, 40, "clip-2")!;

    expect((right.content as VideoContent).sourceInFrame).toBe(40);
  });

  it("scales the source advance by playback speed", () => {
    const clip = makeClip({
      startFrame: 0,
      durationFrames: 100,
      content: { ...(makeClip().content as VideoContent), speed: 2 },
    });
    const [, right] = splitClip(clip, 40, "clip-2")!;

    // At 2x, 40 timeline frames consume 80 source frames.
    expect((right.content as VideoContent).sourceInFrame).toBe(80);
  });

  it("refuses to split at or outside the clip boundaries", () => {
    const clip = makeClip({ startFrame: 10, durationFrames: 100 });

    expect(splitClip(clip, 10, "x")).toBeNull();
    expect(splitClip(clip, 110, "x")).toBeNull();
    expect(splitClip(clip, 5, "x")).toBeNull();
    expect(splitClip(clip, 200, "x")).toBeNull();
  });

  it("gives the new id to the right half only", () => {
    const clip = makeClip({ id: "original" });
    const [left, right] = splitClip(clip, 50, "fresh")!;

    expect(left.id).toBe("original");
    expect(right.id).toBe("fresh");
  });
});

describe("trimClipStart", () => {
  it("holds the end fixed while moving the start", () => {
    const clip = makeClip({ startFrame: 10, durationFrames: 100 });
    const trimmed = trimClipStart(clip, 30)!;

    expect(trimmed.startFrame).toBe(30);
    expect(trimmed.durationFrames).toBe(80);
    expect(trimmed.startFrame + trimmed.durationFrames).toBe(110);
  });

  it("advances the source so visible content does not shift", () => {
    const clip = makeClip({ startFrame: 10, durationFrames: 100 });
    const trimmed = trimClipStart(clip, 30)!;

    expect((trimmed.content as VideoContent).sourceInFrame).toBe(20);
  });

  it("clamps so the clip never collapses past the minimum length", () => {
    const clip = makeClip({ startFrame: 0, durationFrames: 100 });
    const trimmed = trimClipStart(clip, 500)!;

    expect(trimmed.durationFrames).toBe(1);
  });

  it("returns null for a no-op trim", () => {
    const clip = makeClip({ startFrame: 10 });
    expect(trimClipStart(clip, 10)).toBeNull();
  });
});

describe("trimClipEnd", () => {
  it("holds the start fixed while moving the end", () => {
    const clip = makeClip({ startFrame: 10, durationFrames: 100 });
    const trimmed = trimClipEnd(clip, 60)!;

    expect(trimmed.startFrame).toBe(10);
    expect(trimmed.durationFrames).toBe(50);
  });

  it("does not alter the source in-point", () => {
    const clip = makeClip({ startFrame: 0, durationFrames: 100 });
    const trimmed = trimClipEnd(clip, 50)!;

    expect((trimmed.content as VideoContent).sourceInFrame).toBe(0);
  });

  it("clamps to the minimum clip length", () => {
    const clip = makeClip({ startFrame: 10, durationFrames: 100 });
    const trimmed = trimClipEnd(clip, 0)!;

    expect(trimmed.durationFrames).toBe(1);
  });
});

describe("rippleDelete", () => {
  it("closes the gap left by the deleted clip", () => {
    const clips = [
      makeClip({ id: "a", startFrame: 0, durationFrames: 50 }),
      makeClip({ id: "b", startFrame: 50, durationFrames: 30 }),
      makeClip({ id: "c", startFrame: 80, durationFrames: 40 }),
    ];

    const result = rippleDelete(clips, "b");

    expect(result.map((c) => c.id)).toEqual(["a", "c"]);
    expect(result[1]!.startFrame).toBe(50);
  });

  it("leaves earlier clips untouched", () => {
    const clips = [
      makeClip({ id: "a", startFrame: 0, durationFrames: 50 }),
      makeClip({ id: "b", startFrame: 100, durationFrames: 30 }),
    ];

    const result = rippleDelete(clips, "b");
    expect(result).toHaveLength(1);
    expect(result[0]!.startFrame).toBe(0);
  });

  it("is a no-op for an unknown id", () => {
    const clips = [makeClip({ id: "a" })];
    expect(rippleDelete(clips, "missing")).toEqual(clips);
  });
});

describe("rippleInsert", () => {
  it("pushes clips at or after the insertion point to the right", () => {
    const clips = [
      makeClip({ id: "a", startFrame: 0, durationFrames: 50 }),
      makeClip({ id: "b", startFrame: 50, durationFrames: 30 }),
    ];

    const result = rippleInsert(clips, 50, 20);

    expect(result[0]!.startFrame).toBe(0);
    expect(result[1]!.startFrame).toBe(70);
  });

  it("ignores non-positive durations", () => {
    const clips = [makeClip({ id: "a", startFrame: 10 })];
    expect(rippleInsert(clips, 0, 0)[0]!.startFrame).toBe(10);
  });
});

describe("moveClip", () => {
  it("clamps to a non-negative start frame", () => {
    const clip = makeClip({ startFrame: 10 });
    expect(moveClip(clip, -50).startFrame).toBe(0);
  });

  it("reassigns the track when one is given", () => {
    const clip = makeClip({ trackId: "track-1" });
    expect(moveClip(clip, 0, "track-2").trackId).toBe("track-2");
    expect(moveClip(clip, 0).trackId).toBe("track-1");
  });
});

describe("computeDuration", () => {
  it("returns the furthest clip end, not the sum of durations", () => {
    const clips = [
      makeClip({ id: "a", startFrame: 0, durationFrames: 100 }),
      makeClip({ id: "b", startFrame: 20, durationFrames: 30 }),
    ];

    expect(computeDuration(clips)).toBe(100);
  });

  it("returns zero for an empty timeline", () => {
    expect(computeDuration([])).toBe(0);
  });
});

describe("purity", () => {
  it("never mutates its inputs", () => {
    const clip = makeClip({ startFrame: 10, durationFrames: 100 });
    const snapshot = structuredClone(clip);

    splitClip(clip, 50, "x");
    trimClipStart(clip, 30);
    trimClipEnd(clip, 80);
    moveClip(clip, 500);
    rippleDelete([clip], clip.id);

    expect(clip).toEqual(snapshot);
  });
});

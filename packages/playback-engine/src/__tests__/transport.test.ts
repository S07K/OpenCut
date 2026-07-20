import { describe, expect, it } from "vitest";
import {
  applyBounds,
  frameAt,
  resolveRange,
  secondsUntilClip,
  sourceOffsetSeconds,
  startPlayback,
  tick,
  type TransportBounds,
  type TransportOrigin,
} from "../transport";

const origin: TransportOrigin = { startFrame: 0, startedAtSeconds: 100, rate: 1 };
const bounds: TransportBounds = { durationFrames: 300, loop: false };

describe("frameAt", () => {
  it("derives the frame from elapsed clock time", () => {
    expect(frameAt(origin, 100, 30)).toBe(0);
    expect(frameAt(origin, 101, 30)).toBe(30);
    expect(frameAt(origin, 102.5, 30)).toBe(75);
  });

  it("returns fractional frames rather than rounding", () => {
    // Audio scheduling needs sub-frame precision; rounding here would discard
    // it irrecoverably.
    expect(frameAt(origin, 100.5, 30)).toBeCloseTo(15);
    expect(frameAt(origin, 100.01, 30)).toBeCloseTo(0.3);
  });

  it("honours the playback rate", () => {
    expect(frameAt({ ...origin, rate: 2 }, 101, 30)).toBe(60);
    expect(frameAt({ ...origin, rate: 0.5 }, 101, 30)).toBe(15);
  });

  it("offsets from the starting frame", () => {
    expect(frameAt({ ...origin, startFrame: 90 }, 101, 30)).toBe(120);
  });

  it("never runs backwards if the clock reads earlier than the origin", () => {
    expect(frameAt(origin, 99, 30)).toBe(0);
  });

  it("does not accumulate drift over a long run", () => {
    // The reason the playhead is derived rather than accumulated: after an hour
    // the position must still be exact.
    const anHour = 3600;
    expect(frameAt(origin, 100 + anHour, 30)).toBe(anHour * 30);
  });
});

describe("applyBounds", () => {
  it("passes through positions inside the range", () => {
    expect(applyBounds(150, bounds)).toEqual({ frame: 150, ended: false });
  });

  it("stops at the end when not looping", () => {
    expect(applyBounds(400, bounds)).toEqual({ frame: 300, ended: true });
  });

  it("wraps by modulo when looping, preserving the overshoot", () => {
    // A slow tick that overshoots by 50 must resume 50 frames in, not snap to
    // the start and silently lose that time.
    expect(applyBounds(350, { ...bounds, loop: true })).toEqual({ frame: 50, ended: false });
  });

  it("clamps positions before the range start", () => {
    expect(applyBounds(-10, bounds)).toEqual({ frame: 0, ended: false });
  });

  it("respects in and out points", () => {
    const ranged: TransportBounds = { ...bounds, inFrame: 100, outFrame: 200 };

    expect(applyBounds(50, ranged).frame).toBe(100);
    expect(applyBounds(150, ranged).frame).toBe(150);
    expect(applyBounds(250, ranged)).toEqual({ frame: 200, ended: true });
  });

  it("loops within an in/out range", () => {
    const ranged: TransportBounds = { ...bounds, inFrame: 100, outFrame: 200, loop: true };
    expect(applyBounds(210, ranged).frame).toBe(110);
  });
});

describe("resolveRange", () => {
  it("defaults to the whole timeline", () => {
    expect(resolveRange(bounds)).toEqual({ start: 0, end: 300 });
  });

  it("never produces a zero-width range", () => {
    // A degenerate range would divide by zero in the loop wrap.
    expect(resolveRange({ ...bounds, inFrame: 50, outFrame: 50 })).toEqual({
      start: 50,
      end: 51,
    });
  });
});

describe("startPlayback", () => {
  it("continues from the current position", () => {
    const result = startPlayback(120, 500, bounds);
    expect(result).toEqual({ startFrame: 120, startedAtSeconds: 500, rate: 1 });
  });

  it("rewinds when starting at the end", () => {
    // Pressing play on a finished timeline should replay it, not sit still.
    expect(startPlayback(300, 0, bounds).startFrame).toBe(0);
    expect(startPlayback(299, 0, bounds).startFrame).toBe(0);
  });

  it("rewinds to the in point when before it", () => {
    const ranged: TransportBounds = { ...bounds, inFrame: 100, outFrame: 200 };
    expect(startPlayback(10, 0, ranged).startFrame).toBe(100);
  });
});

describe("tick", () => {
  it("combines derivation and bounding", () => {
    expect(tick(origin, 102, 30, bounds)).toEqual({ frame: 60, ended: false });
  });

  it("reports the end of a non-looping timeline", () => {
    expect(tick(origin, 200, 30, bounds).ended).toBe(true);
  });
});

describe("sourceOffsetSeconds", () => {
  it("returns the in-point for a clip starting now", () => {
    expect(sourceOffsetSeconds(100, 60, 0, 1, 100, 30)).toBeCloseTo(0);
  });

  it("accounts for how far into the clip the playhead is", () => {
    // 30 frames into the clip at 30fps → 1 second of source consumed.
    expect(sourceOffsetSeconds(100, 60, 0, 1, 130, 30)).toBeCloseTo(1);
  });

  it("adds the source in-point", () => {
    expect(sourceOffsetSeconds(100, 60, 60, 1, 100, 30)).toBeCloseTo(2);
  });

  it("consumes source faster at higher speed", () => {
    expect(sourceOffsetSeconds(100, 60, 0, 2, 130, 30)).toBeCloseTo(2);
  });

  it("returns null for a clip that has already finished", () => {
    expect(sourceOffsetSeconds(100, 60, 0, 1, 160, 30)).toBeNull();
    expect(sourceOffsetSeconds(100, 60, 0, 1, 200, 30)).toBeNull();
  });

  it("clamps to the in-point for a clip that has not started", () => {
    expect(sourceOffsetSeconds(100, 60, 0, 1, 50, 30)).toBeCloseTo(0);
  });
});

describe("secondsUntilClip", () => {
  it("is zero for a clip already playing", () => {
    expect(secondsUntilClip(100, 150, 30, 1)).toBe(0);
    expect(secondsUntilClip(100, 100, 30, 1)).toBe(0);
  });

  it("converts the frame gap to wall seconds", () => {
    expect(secondsUntilClip(130, 100, 30, 1)).toBeCloseTo(1);
  });

  it("shortens the wait at higher playback rates", () => {
    expect(secondsUntilClip(130, 100, 30, 2)).toBeCloseTo(0.5);
  });
});

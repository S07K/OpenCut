import { describe, expect, it } from "vitest";
import type { Marker } from "@cutaway/types";
import { DEFAULT_SNAP_THRESHOLD_PX, snapClipDrag, snapFrame, type SnapContext } from "../snapping";
import { makeClip } from "./fixtures";

function makeContext(overrides: Partial<SnapContext> = {}): SnapContext {
  return {
    clips: [],
    markers: [],
    playhead: 0,
    excludeClipIds: new Set(),
    pixelsPerFrame: 1,
    thresholdPx: DEFAULT_SNAP_THRESHOLD_PX,
    ...overrides,
  };
}

describe("snapFrame", () => {
  it("snaps to a nearby clip edge", () => {
    const context = makeContext({
      clips: [makeClip({ id: "a", startFrame: 100, durationFrames: 50 })],
    });

    expect(snapFrame(103, context).frame).toBe(100);
    expect(snapFrame(148, context).frame).toBe(150);
  });

  it("leaves the frame alone when nothing is within the threshold", () => {
    const context = makeContext({
      clips: [makeClip({ id: "a", startFrame: 100, durationFrames: 50 })],
    });

    const result = snapFrame(500, context);
    expect(result.frame).toBe(500);
    expect(result.target).toBeNull();
  });

  it("excludes the clips being dragged", () => {
    const context = makeContext({
      clips: [makeClip({ id: "dragged", startFrame: 100, durationFrames: 50 })],
      excludeClipIds: new Set(["dragged"]),
    });

    expect(snapFrame(102, context).target).toBeNull();
  });

  it("keeps the same pixel feel when zoomed in", () => {
    // At 10 px/frame an 8 px threshold is well under one frame, so a 3-frame
    // gap must not snap — the exact opposite of the zoomed-out case above.
    const context = makeContext({
      clips: [makeClip({ id: "a", startFrame: 100, durationFrames: 50 })],
      pixelsPerFrame: 10,
    });

    expect(snapFrame(103, context).target).toBeNull();
    expect(snapFrame(100, context).frame).toBe(100);
  });

  it("snaps to the playhead and to markers", () => {
    const marker: Marker = {
      id: "m1",
      frame: 300,
      label: "Beat",
      color: "#fff",
      durationFrames: 0,
    };
    const context = makeContext({ playhead: 200, markers: [marker] });

    expect(snapFrame(203, context).frame).toBe(200);
    expect(snapFrame(203, context).target?.kind).toBe("playhead");
    expect(snapFrame(297, context).frame).toBe(300);
    expect(snapFrame(297, context).target?.kind).toBe("marker");
  });

  it("prefers the closest of several candidates", () => {
    const context = makeContext({
      clips: [
        makeClip({ id: "a", startFrame: 100, durationFrames: 10 }),
        makeClip({ id: "b", startFrame: 105, durationFrames: 10 }),
      ],
    });

    expect(snapFrame(104, context).frame).toBe(105);
  });
});

describe("snapClipDrag", () => {
  it("snaps by the trailing edge so clips butt-join cleanly", () => {
    const context = makeContext({
      clips: [makeClip({ id: "a", startFrame: 200, durationFrames: 50 })],
    });

    // A 100-frame clip dropped at 97 puts its tail at 197 — 3 frames from the
    // neighbour's head, so the tail should win and the start become 100.
    const result = snapClipDrag(97, 100, context);
    expect(result.frame).toBe(100);
    expect(result.target?.kind).toBe("clip-start");
  });

  it("snaps by the leading edge when that edge is closer", () => {
    const context = makeContext({
      clips: [makeClip({ id: "a", startFrame: 100, durationFrames: 50 })],
    });

    const result = snapClipDrag(148, 500, context);
    expect(result.frame).toBe(150);
  });

  it("returns the proposal untouched when neither edge snaps", () => {
    const context = makeContext({ playhead: 5000 });
    const result = snapClipDrag(300, 100, context);

    expect(result.frame).toBe(300);
    expect(result.target).toBeNull();
  });
});

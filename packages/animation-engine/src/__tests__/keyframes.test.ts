import { describe, expect, it } from "vitest";
import type { Animatable } from "@cutaway/types";
import { staticValue } from "@cutaway/types";
import {
  hasKeyframeAt,
  isAnimatedTrack,
  keyframeFrames,
  moveKeyframe,
  removeKeyframe,
  setKeyframe,
  setKeyframeEasing,
  setValueAt,
  toStatic,
} from "../keyframes";
import { evaluate } from "../evaluate";

const linear = { kind: "linear" } as const;

function animated(pairs: [number, number][]): Animatable<number> {
  return {
    type: "animated",
    keyframes: pairs.map(([frame, value]) => ({ frame, value, easing: linear })),
  };
}

describe("setKeyframe", () => {
  it("promotes a static value to an animated track", () => {
    const result = setKeyframe(staticValue(5), 10, 7);
    expect(result.type).toBe("animated");
    expect(result.keyframes).toEqual([{ frame: 10, value: 7, easing: linear }]);
  });

  it("inserts keyframes in sorted order", () => {
    let value = setKeyframe(staticValue(0), 20, 2);
    value = setKeyframe(value, 5, 1);
    value = setKeyframe(value, 30, 3);

    expect(keyframeFrames(value)).toEqual([5, 20, 30]);
  });

  it("replaces a keyframe on the same frame rather than duplicating", () => {
    let value = setKeyframe(staticValue(0), 10, 1);
    value = setKeyframe(value, 10, 99);

    expect(value.keyframes).toHaveLength(1);
    expect(value.keyframes[0]!.value).toBe(99);
  });

  it("keeps the track evaluable at the keyframe", () => {
    const value = setKeyframe(setKeyframe(staticValue(0), 0, 0), 10, 100);
    expect(evaluate(value, 5)).toBe(50);
  });
});

describe("removeKeyframe", () => {
  it("removes a keyframe", () => {
    const value = removeKeyframe(
      animated([
        [0, 0],
        [10, 10],
        [20, 20],
      ]),
      10,
    );
    expect(keyframeFrames(value)).toEqual([0, 20]);
  });

  it("collapses to a static value when the last keyframe is removed", () => {
    // An animated value with zero keyframes is illegal — the evaluator throws.
    const value = removeKeyframe(animated([[10, 42]]), 10);
    expect(value.type).toBe("static");
    if (value.type === "static") expect(value.value).toBe(42);
  });

  it("is a no-op for a frame with no keyframe", () => {
    const original = animated([
      [0, 0],
      [10, 10],
    ]);
    expect(removeKeyframe(original, 5)).toBe(original);
  });

  it("is a no-op on a static value", () => {
    const original = staticValue(3);
    expect(removeKeyframe(original, 0)).toBe(original);
  });
});

describe("moveKeyframe", () => {
  it("moves a keyframe and keeps the track sorted", () => {
    const value = moveKeyframe(
      animated([
        [0, 0],
        [10, 10],
        [20, 20],
      ]),
      10,
      25,
    );
    expect(keyframeFrames(value)).toEqual([0, 20, 25]);
  });

  it("carries the value and easing with the moved keyframe", () => {
    const value = moveKeyframe(animated([[5, 88]]), 5, 15);
    expect(value.type === "animated" && value.keyframes[0]).toEqual({
      frame: 15,
      value: 88,
      easing: linear,
    });
  });

  it("merges when dragged onto another keyframe", () => {
    const value = moveKeyframe(
      animated([
        [0, 1],
        [10, 2],
      ]),
      0,
      10,
    );
    expect(keyframeFrames(value)).toEqual([10]);
    expect(value.type === "animated" && value.keyframes[0]!.value).toBe(1);
  });

  it("is a no-op when source and destination match", () => {
    const original = animated([
      [0, 0],
      [10, 10],
    ]);
    expect(moveKeyframe(original, 10, 10)).toBe(original);
  });
});

describe("setValueAt", () => {
  it("edits the value of an existing keyframe", () => {
    const value = setValueAt(
      animated([
        [0, 0],
        [10, 10],
      ]),
      10,
      99,
    );
    expect(value.type === "animated" && value.keyframes[1]!.value).toBe(99);
  });

  it("adds a keyframe when editing between existing ones", () => {
    // The value the user sees at the playhead is the value they mean to pin.
    const value = setValueAt(
      animated([
        [0, 0],
        [20, 20],
      ]),
      10,
      5,
    );
    expect(keyframeFrames(value)).toEqual([0, 10, 20]);
  });

  it("replaces a static value in place", () => {
    const value = setValueAt(staticValue(1), 50, 9);
    expect(value).toEqual({ type: "static", value: 9 });
  });
});

describe("setKeyframeEasing", () => {
  it("changes only the targeted keyframe's easing", () => {
    const value = setKeyframeEasing(
      animated([
        [0, 0],
        [10, 10],
      ]),
      0,
      { kind: "ease-in" },
    );
    if (value.type !== "animated") throw new Error("expected animated");

    expect(value.keyframes[0]!.easing).toEqual({ kind: "ease-in" });
    expect(value.keyframes[1]!.easing).toEqual(linear);
  });
});

describe("predicates", () => {
  it("detects a keyframe on an exact frame", () => {
    const value = animated([
      [0, 0],
      [10, 10],
    ]);
    expect(hasKeyframeAt(value, 10)).toBe(true);
    expect(hasKeyframeAt(value, 5)).toBe(false);
    expect(hasKeyframeAt(staticValue(0), 0)).toBe(false);
  });

  it("treats a single-keyframe track as not truly animated", () => {
    // One keyframe evaluates to a constant everywhere — it does not animate
    // until it has a second.
    expect(isAnimatedTrack(animated([[10, 5]]))).toBe(false);
    expect(
      isAnimatedTrack(
        animated([
          [0, 0],
          [10, 5],
        ]),
      ),
    ).toBe(true);
    expect(isAnimatedTrack(staticValue(0))).toBe(false);
  });
});

describe("toStatic", () => {
  it("wraps a constant", () => {
    expect(toStatic(7)).toEqual({ type: "static", value: 7 });
  });
});

describe("purity", () => {
  it("never mutates its input", () => {
    const original = animated([
      [0, 0],
      [10, 10],
    ]);
    const snapshot = structuredClone(original);

    setKeyframe(original, 5, 5);
    removeKeyframe(original, 10);
    moveKeyframe(original, 0, 20);
    setValueAt(original, 10, 99);

    expect(original).toEqual(snapshot);
  });
});

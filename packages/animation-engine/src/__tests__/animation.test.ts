import { describe, expect, it } from "vitest";
import type { AnimatedValue, Keyframe } from "@cutaway/types";
import { staticValue } from "@cutaway/types";
import { applyEasing, cubicBezier, easeIn, easeInOut, easeOut, spring } from "../easing";
import { formatHexColor, interpolate, lerp, lerpColor, parseHexColor } from "../interpolate";
import { evaluate, findKeyframeIndex } from "../evaluate";

const linearEase = { kind: "linear" } as const;

function track<T>(keyframes: Keyframe<T>[]): AnimatedValue<T> {
  return { type: "animated", keyframes };
}

describe("easing", () => {
  it("pins endpoints for every easing kind", () => {
    const kinds = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;
    for (const kind of kinds) {
      expect(applyEasing({ kind }, 0)).toBeCloseTo(0);
      expect(applyEasing({ kind }, 1)).toBeCloseTo(1);
    }
  });

  it("eases in below the diagonal and out above it", () => {
    expect(easeIn(0.5)).toBeLessThan(0.5);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });

  it("holds at the previous value until the next keyframe", () => {
    expect(applyEasing({ kind: "hold" }, 0.99)).toBe(0);
  });
});

describe("cubicBezier", () => {
  it("is the identity when control points lie on the diagonal", () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(cubicBezier(t, 0, 0, 1, 1)).toBeCloseTo(t, 5);
    }
  });

  it("matches CSS ease-in-out at the midpoint", () => {
    expect(cubicBezier(0.5, 0.42, 0, 0.58, 1)).toBeCloseTo(0.5, 3);
  });

  it("is monotonic for a standard ease curve", () => {
    let previous = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const value = cubicBezier(t, 0.25, 0.1, 0.25, 1);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("clamps outside the unit interval", () => {
    expect(cubicBezier(-1, 0.42, 0, 0.58, 1)).toBe(0);
    expect(cubicBezier(2, 0.42, 0, 0.58, 1)).toBe(1);
  });
});

describe("spring", () => {
  it("starts at rest and ends settled", () => {
    expect(spring(0, 180, 12, 1)).toBe(0);
    expect(spring(1, 180, 12, 1)).toBe(1);
  });

  it("overshoots when underdamped", () => {
    // The whole point of a spring: it must pass 1 before settling, otherwise
    // it is just a slow ease and the preset is a lie.
    let peak = 0;
    for (let t = 0; t < 1; t += 0.01) {
      peak = Math.max(peak, spring(t, 180, 8, 1));
    }
    expect(peak).toBeGreaterThan(1);
  });

  it("does not overshoot when critically damped", () => {
    for (let t = 0; t <= 1; t += 0.01) {
      expect(spring(t, 180, 26.8, 1)).toBeLessThanOrEqual(1.001);
    }
  });
});

describe("color interpolation", () => {
  it("parses shorthand, full, and alpha hex", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHexColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseHexColor("#ff000080")?.a).toBeCloseTo(0.502, 2);
  });

  it("rejects unparseable colors instead of guessing", () => {
    expect(parseHexColor("red")).toBeNull();
    expect(parseHexColor("rgb(1,2,3)")).toBeNull();
  });

  it("round-trips through format", () => {
    expect(formatHexColor({ r: 18, g: 52, b: 86, a: 1 })).toBe("#123456");
  });

  it("blends channel-wise", () => {
    expect(lerpColor("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(lerpColor("#ff0000", "#0000ff", 0)).toBe("#ff0000");
    expect(lerpColor("#ff0000", "#0000ff", 1)).toBe("#0000ff");
  });
});

describe("interpolate", () => {
  it("handles numbers, points, and colors", () => {
    expect(interpolate(0, 10, 0.5)).toBe(5);
    expect(interpolate({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
    expect(interpolate("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("blends numeric fields of compound objects", () => {
    const from = { top: 0, right: 0, bottom: 0, left: 0 };
    const to = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(interpolate(from, to, 0.5)).toEqual({ top: 5, right: 10, bottom: 15, left: 20 });
  });

  it("snaps values that cannot be blended", () => {
    expect(interpolate(true, false, 0.4)).toBe(true);
    expect(interpolate(true, false, 0.6)).toBe(false);
    expect(interpolate("left", "right", 0.6)).toBe("right");
  });
});

describe("findKeyframeIndex", () => {
  const keyframes: Keyframe<number>[] = [0, 10, 20, 30].map((frame) => ({
    frame,
    value: frame,
    easing: linearEase,
  }));

  it("finds the last keyframe at or before the frame", () => {
    expect(findKeyframeIndex(keyframes, 0)).toBe(0);
    expect(findKeyframeIndex(keyframes, 15)).toBe(1);
    expect(findKeyframeIndex(keyframes, 20)).toBe(2);
    expect(findKeyframeIndex(keyframes, 999)).toBe(3);
  });

  it("returns -1 before the first keyframe", () => {
    expect(findKeyframeIndex(keyframes, -5)).toBe(-1);
  });
});

describe("evaluate", () => {
  it("returns static values unchanged", () => {
    expect(evaluate(staticValue(42), 999)).toBe(42);
  });

  it("interpolates between keyframes", () => {
    const value = track<number>([
      { frame: 0, value: 0, easing: linearEase },
      { frame: 10, value: 100, easing: linearEase },
    ]);

    expect(evaluate(value, 0)).toBe(0);
    expect(evaluate(value, 5)).toBe(50);
    expect(evaluate(value, 10)).toBe(100);
  });

  it("clamps outside the keyframe range rather than extrapolating", () => {
    // Extrapolation would make a scale grow forever past its last keyframe.
    const value = track<number>([
      { frame: 10, value: 5, easing: linearEase },
      { frame: 20, value: 15, easing: linearEase },
    ]);

    expect(evaluate(value, 0)).toBe(5);
    expect(evaluate(value, 500)).toBe(15);
  });

  it("applies the easing of the outgoing keyframe", () => {
    const eased = track<number>([
      { frame: 0, value: 0, easing: { kind: "ease-in" } },
      { frame: 10, value: 100, easing: linearEase },
    ]);

    // ease-in at the midpoint is 0.25, not 0.5.
    expect(evaluate(eased, 5)).toBeCloseTo(25);
  });

  it("holds the previous value across a hold segment", () => {
    const held = track<number>([
      { frame: 0, value: 7, easing: { kind: "hold" } },
      { frame: 10, value: 99, easing: linearEase },
    ]);

    expect(evaluate(held, 9)).toBe(7);
    expect(evaluate(held, 10)).toBe(99);
  });

  it("animates points and colors", () => {
    const position = track([
      { frame: 0, value: { x: 0, y: 0 }, easing: linearEase },
      { frame: 10, value: { x: 100, y: 50 }, easing: linearEase },
    ]);
    expect(evaluate(position, 5)).toEqual({ x: 50, y: 25 });

    const color = track([
      { frame: 0, value: "#000000", easing: linearEase },
      { frame: 10, value: "#ffffff", easing: linearEase },
    ]);
    expect(evaluate(color, 5)).toBe("#808080");
  });

  it("handles a single keyframe", () => {
    const value = track<number>([{ frame: 50, value: 3, easing: linearEase }]);
    expect(evaluate(value, 0)).toBe(3);
    expect(evaluate(value, 100)).toBe(3);
  });

  it("does not divide by zero on coincident keyframes", () => {
    const value = track<number>([
      { frame: 5, value: 1, easing: linearEase },
      { frame: 5, value: 9, easing: linearEase },
      { frame: 10, value: 20, easing: linearEase },
    ]);

    expect(Number.isFinite(evaluate(value, 5))).toBe(true);
  });

  it("throws on an animated value with no keyframes", () => {
    expect(() => evaluate(track<number>([]), 0)).toThrow();
  });
});

describe("lerp", () => {
  it("interpolates and extrapolates linearly", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(10, 20, 0)).toBe(10);
  });
});

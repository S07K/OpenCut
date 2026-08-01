import { describe, expect, it } from "vitest";
import { staticValue } from "@opencut/types";
import type { Mask } from "@opencut/types";
import {
  ELLIPSE_SEGMENTS,
  expandPolygon,
  pointInPolygon,
  resolveMask,
  resolveMasks,
  shapeToPolygon,
} from "../evaluate";
import { createEllipseMask, createPathMask, createRectangleMask } from "../factory";

describe("shapeToPolygon — rectangle", () => {
  it("produces four corners for a square with no rounding", () => {
    const shape = createRectangleMask({ x: 100, y: 100 }, { x: 40, y: 20 }).shape;
    const polygon = shapeToPolygon(shape, 0);

    expect(polygon).toHaveLength(4);
    expect(polygon).toContainEqual({ x: 80, y: 90 });
    expect(polygon).toContainEqual({ x: 120, y: 110 });
  });

  it("contains its center and excludes points outside", () => {
    const shape = createRectangleMask({ x: 0, y: 0 }, { x: 100, y: 100 }).shape;
    const polygon = shapeToPolygon(shape, 0);

    expect(pointInPolygon({ x: 0, y: 0 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 40, y: 40 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 200, y: 0 }, polygon)).toBe(false);
  });

  it("rounds corners into arcs when cornerRadius is set", () => {
    const polygon = shapeToPolygon(
      {
        kind: "rectangle",
        center: staticValue({ x: 0, y: 0 }),
        size: staticValue({ x: 100, y: 100 }),
        cornerRadius: staticValue(20),
        rotation: staticValue(0),
      },
      0,
    );

    // Rounded corners add many points, and no vertex sits at the sharp corner.
    expect(polygon.length).toBeGreaterThan(4);
    expect(polygon).not.toContainEqual({ x: 50, y: 50 });
  });

  it("clamps corner radius to half the shorter side", () => {
    // A radius past half the side would self-intersect; the shape must stay
    // within its bounds regardless.
    const polygon = shapeToPolygon(
      {
        kind: "rectangle",
        center: staticValue({ x: 0, y: 0 }),
        size: staticValue({ x: 40, y: 40 }),
        cornerRadius: staticValue(999),
        rotation: staticValue(0),
      },
      0,
    );
    for (const p of polygon) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(20.001);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(20.001);
    }
  });
});

describe("shapeToPolygon — ellipse", () => {
  it("tessellates to the configured segment count", () => {
    const shape = createEllipseMask({ x: 0, y: 0 }, { x: 50, y: 30 }).shape;
    expect(shapeToPolygon(shape, 0)).toHaveLength(ELLIPSE_SEGMENTS);
  });

  it("contains its center and excludes points beyond its radii", () => {
    const shape = createEllipseMask({ x: 0, y: 0 }, { x: 50, y: 30 }).shape;
    const polygon = shapeToPolygon(shape, 0);

    expect(pointInPolygon({ x: 0, y: 0 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 49, y: 0 }, polygon)).toBe(true);
    // Just outside the horizontal radius, and well past the vertical one.
    expect(pointInPolygon({ x: 51, y: 0 }, polygon)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 40 }, polygon)).toBe(false);
  });

  it("respects the aspect of the radii", () => {
    const shape = createEllipseMask({ x: 0, y: 0 }, { x: 100, y: 10 }).shape;
    const polygon = shapeToPolygon(shape, 0);

    // Wide but short: (0, 20) is outside, (80, 0) is inside.
    expect(pointInPolygon({ x: 0, y: 20 }, polygon)).toBe(false);
    expect(pointInPolygon({ x: 80, y: 0 }, polygon)).toBe(true);
  });
});

describe("shapeToPolygon — path", () => {
  it("evaluates each vertex", () => {
    const shape = createPathMask([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 80 },
    ]).shape;

    expect(shapeToPolygon(shape, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 80 },
    ]);
  });

  it("evaluates animated vertices at the frame", () => {
    const mask = createPathMask([{ x: 0, y: 0 }]);
    const shape = mask.shape;
    if (shape.kind !== "path") throw new Error("expected path");

    shape.vertices = [
      {
        type: "animated",
        keyframes: [
          { frame: 0, value: { x: 0, y: 0 }, easing: { kind: "linear" } },
          { frame: 10, value: { x: 100, y: 100 }, easing: { kind: "linear" } },
        ],
      },
    ];

    expect(shapeToPolygon(shape, 5)).toEqual([{ x: 50, y: 50 }]);
  });
});

describe("expandPolygon", () => {
  it("grows a square outward from its centroid", () => {
    const square = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ];
    const grown = expandPolygon(square, Math.hypot(10, 10));

    // Each corner moves out along its diagonal by the given amount.
    expect(grown[0]!.x).toBeCloseTo(-20);
    expect(grown[0]!.y).toBeCloseTo(-20);
  });

  it("shrinks with a negative amount", () => {
    const square = [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 20, y: 20 },
      { x: -20, y: 20 },
    ];
    const shrunk = expandPolygon(square, -Math.hypot(10, 10));
    expect(Math.abs(shrunk[0]!.x)).toBeLessThan(20);
  });

  it("is a no-op for zero amount or a degenerate polygon", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(expandPolygon(square, 0)).toEqual(square);
    expect(expandPolygon([{ x: 0, y: 0 }], 5)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("resolveMask", () => {
  it("resolves all modifiers to plain numbers", () => {
    const mask: Mask = {
      ...createEllipseMask({ x: 0, y: 0 }, { x: 40, y: 40 }),
      feather: staticValue(8),
      opacity: staticValue(0.5),
      inverted: true,
      mode: "subtract",
    };

    const resolved = resolveMask(mask, 0);
    expect(resolved.feather).toBe(8);
    expect(resolved.opacity).toBe(0.5);
    expect(resolved.inverted).toBe(true);
    expect(resolved.mode).toBe("subtract");
    expect(resolved.polygon.length).toBe(ELLIPSE_SEGMENTS);
  });

  it("clamps opacity and floors feather", () => {
    const mask: Mask = {
      ...createRectangleMask({ x: 0, y: 0 }, { x: 10, y: 10 }),
      opacity: staticValue(5),
      feather: staticValue(-3),
    };
    const resolved = resolveMask(mask, 0);
    expect(resolved.opacity).toBe(1);
    expect(resolved.feather).toBe(0);
  });

  it("applies expand to the polygon", () => {
    const base = createRectangleMask({ x: 0, y: 0 }, { x: 20, y: 20 });
    const expanded: Mask = { ...base, expand: staticValue(10) };

    const resolved = resolveMask(expanded, 0);
    // A point outside the base rectangle but within the expanded one.
    expect(pointInPolygon({ x: 14, y: 0 }, resolved.polygon)).toBe(true);
  });
});

describe("resolveMasks", () => {
  it("skips disabled masks", () => {
    const a = createRectangleMask({ x: 0, y: 0 }, { x: 10, y: 10 });
    const b = { ...createEllipseMask({ x: 0, y: 0 }, { x: 10, y: 10 }), enabled: false };

    const resolved = resolveMasks([a, b], 0);
    expect(resolved).toHaveLength(1);
  });

  it("preserves stack order", () => {
    const a = { ...createRectangleMask({ x: 0, y: 0 }, { x: 10, y: 10 }), mode: "add" as const };
    const b = {
      ...createEllipseMask({ x: 0, y: 0 }, { x: 10, y: 10 }),
      mode: "subtract" as const,
    };

    expect(resolveMasks([a, b], 0).map((m) => m.mode)).toEqual(["add", "subtract"]);
  });
});

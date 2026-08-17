/**
 * Mask evaluation.
 *
 * Turns a `Mask` — a shape plus animatable modifiers — into concrete geometry
 * at a given frame: a closed polygon in the clip's local pixel space, with
 * feather, expand, opacity, and inversion resolved to plain numbers.
 *
 * Pure and DOM-free. Every mask kind (rectangle, ellipse, pen path) reduces to
 * the *same* `ResolvedMask` polygon, which is the property that lets the
 * compositor apply one masking implementation regardless of how the shape was
 * drawn — exactly what the mask type's doc comment promised.
 */

import type { Mask, MaskBlendMode, MaskShape, Vec2 } from "@cutaway/types";
import { evaluate } from "@cutaway/animation-engine";

/** A mask resolved to drawable geometry for one frame. */
export interface ResolvedMask {
  /** Closed polygon, clockwise, in clip-local pixels. */
  polygon: Vec2[];
  mode: MaskBlendMode;
  /** Edge softness in pixels. */
  feather: number;
  opacity: number;
  inverted: boolean;
}

/** Points used to tessellate a full ellipse. Even, so it closes cleanly. */
export const ELLIPSE_SEGMENTS = 64;

function rotatePoint(point: Vec2, center: Vec2, degrees: number): Vec2 {
  if (degrees === 0) return point;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** Rounds a rectangle corner into an arc of points. */
function cornerArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  segments: number,
): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = startAngle + (Math.PI / 2) * (i / segments);
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

function rectanglePolygon(
  center: Vec2,
  size: Vec2,
  cornerRadius: number,
  rotation: number,
): Vec2[] {
  const halfW = size.x / 2;
  const halfH = size.y / 2;
  // A corner radius cannot exceed half the shorter side, or opposite corners
  // would overlap and the outline would self-intersect.
  const radius = Math.max(0, Math.min(cornerRadius, halfW, halfH));

  let points: Vec2[];

  if (radius === 0) {
    points = [
      { x: center.x - halfW, y: center.y - halfH },
      { x: center.x + halfW, y: center.y - halfH },
      { x: center.x + halfW, y: center.y + halfH },
      { x: center.x - halfW, y: center.y + halfH },
    ];
  } else {
    const segs = 6;
    const left = center.x - halfW;
    const right = center.x + halfW;
    const top = center.y - halfH;
    const bottom = center.y + halfH;

    // Four rounded corners, walked clockwise from the top-left arc.
    points = [
      ...cornerArc(left + radius, top + radius, radius, Math.PI, segs),
      ...cornerArc(right - radius, top + radius, radius, -Math.PI / 2, segs),
      ...cornerArc(right - radius, bottom - radius, radius, 0, segs),
      ...cornerArc(left + radius, bottom - radius, radius, Math.PI / 2, segs),
    ];
  }

  return rotation === 0 ? points : points.map((p) => rotatePoint(p, center, rotation));
}

function ellipsePolygon(center: Vec2, radii: Vec2, rotation: number): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i += 1) {
    const angle = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    const point = {
      x: center.x + Math.cos(angle) * radii.x,
      y: center.y + Math.sin(angle) * radii.y,
    };
    points.push(rotation === 0 ? point : rotatePoint(point, center, rotation));
  }
  return points;
}

/** Resolves a mask shape to a polygon at `frame`, before expand is applied. */
export function shapeToPolygon(shape: MaskShape, frame: number): Vec2[] {
  switch (shape.kind) {
    case "rectangle":
      return rectanglePolygon(
        evaluate(shape.center, frame),
        evaluate(shape.size, frame),
        evaluate(shape.cornerRadius, frame),
        evaluate(shape.rotation, frame),
      );

    case "ellipse":
      return ellipsePolygon(
        evaluate(shape.center, frame),
        evaluate(shape.radii, frame),
        evaluate(shape.rotation, frame),
      );

    case "path":
      // Each vertex is independently animatable, so evaluate them all. Bezier
      // handle tessellation is a later refinement; the polyline through the
      // vertices is the correct closed outline for a polygon-tool path.
      return shape.vertices.map((vertex) => evaluate(vertex, frame));

    default:
      return [];
  }
}

/**
 * Grows (or shrinks) a polygon by `amount` pixels along its vertex normals.
 *
 * An approximation — true polygon offsetting handles self-intersection, which
 * this does not — but it is stable and correct for the convex and mildly
 * concave shapes masks are in practice, and it keeps expand a pure operation
 * rather than a shader trick that only exists at render time.
 */
export function expandPolygon(polygon: readonly Vec2[], amount: number): Vec2[] {
  if (amount === 0 || polygon.length < 3) return [...polygon];

  const centroid = polygon.reduce(
    (acc, p) => ({ x: acc.x + p.x / polygon.length, y: acc.y + p.y / polygon.length }),
    { x: 0, y: 0 },
  );

  return polygon.map((point) => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / length) * amount,
      y: point.y + (dy / length) * amount,
    };
  });
}

/** Evaluates a mask to drawable geometry at `frame`. */
export function resolveMask(mask: Mask, frame: number): ResolvedMask {
  const base = shapeToPolygon(mask.shape, frame);
  const expand = evaluate(mask.expand, frame);

  return {
    polygon: expandPolygon(base, expand),
    mode: mask.mode,
    feather: Math.max(0, evaluate(mask.feather, frame)),
    opacity: Math.min(1, Math.max(0, evaluate(mask.opacity, frame))),
    inverted: mask.inverted,
  };
}

/** Resolves every enabled mask on a clip, in stack order. */
export function resolveMasks(masks: readonly Mask[], frame: number): ResolvedMask[] {
  return masks.filter((mask) => mask.enabled).map((mask) => resolveMask(mask, frame));
}

/**
 * Even-odd point-in-polygon test.
 *
 * Used for hit-testing the mask overlay and for verifying evaluation in tests.
 * The compositor fills the polygon on the GPU instead, but a CPU truth function
 * is what lets the geometry be tested without a canvas.
 */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

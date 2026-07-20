/**
 * Masking model — a flagship feature, so it gets a first-class document shape
 * rather than being folded into effects.
 *
 * A mask is a *shape* plus *modifiers*. Keeping those separate is what lets the
 * pen tool, the shape primitives, and future motion-tracked masks all share one
 * feather/expand/invert implementation in the compositor.
 */

import type { Animatable, MotionPath } from "./animation.js";
import type { Degrees, Id, Unit, Vec2 } from "./primitives.js";

export interface RectangleMaskShape {
  kind: "rectangle";
  center: Animatable<Vec2>;
  size: Animatable<Vec2>;
  cornerRadius: Animatable<number>;
  rotation: Animatable<Degrees>;
}

export interface EllipseMaskShape {
  kind: "ellipse";
  center: Animatable<Vec2>;
  radii: Animatable<Vec2>;
  rotation: Animatable<Degrees>;
}

/**
 * Free-form path, produced by the polygon or pen tool.
 *
 * Both tools emit this same shape; the pen tool simply populates `handles`.
 * One representation means one renderer and one set of edit operations.
 */
export interface PathMaskShape {
  kind: "path";
  /** Each vertex is animatable so the whole path can be keyframed. */
  vertices: Animatable<Vec2>[];
  handles: { in: Vec2; out: Vec2 }[];
  closed: boolean;
}

export type MaskShape = RectangleMaskShape | EllipseMaskShape | PathMaskShape;

/** How a mask combines with the masks above it in the stack. */
export type MaskBlendMode = "add" | "subtract" | "intersect" | "difference";

export interface Mask {
  id: Id;
  name: string;
  enabled: boolean;
  shape: MaskShape;
  mode: MaskBlendMode;
  /** Softens the mask edge, in pixels. */
  feather: Animatable<number>;
  /** Grows (+) or shrinks (-) the mask boundary, in pixels. */
  expand: Animatable<number>;
  opacity: Animatable<Unit>;
  inverted: boolean;
  /** Optional path the mask travels along — the basis for future tracking. */
  motionPath?: MotionPath;
}

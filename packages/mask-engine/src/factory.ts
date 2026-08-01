/**
 * Mask constructors.
 *
 * Every mask is built through these so defaults live in one place, the same
 * reason the document factories exist. New masks default to enabled, additive,
 * unfeathered, and fully opaque — the state a user expects the moment they draw
 * one.
 */

import type { Mask, MaskShape, Vec2 } from "@opencut/types";
import { staticValue } from "@opencut/types";

let counter = 0;
function maskId(): string {
  counter += 1;
  return `mask_${Date.now().toString(36)}_${counter}`;
}

function baseMask(name: string, shape: MaskShape): Mask {
  return {
    id: maskId(),
    name,
    enabled: true,
    shape,
    mode: "add",
    feather: staticValue(0),
    expand: staticValue(0),
    opacity: staticValue(1),
    inverted: false,
  };
}

export function createRectangleMask(center: Vec2, size: Vec2): Mask {
  return baseMask("Rectangle mask", {
    kind: "rectangle",
    center: staticValue(center),
    size: staticValue(size),
    cornerRadius: staticValue(0),
    rotation: staticValue(0),
  });
}

export function createEllipseMask(center: Vec2, radii: Vec2): Mask {
  return baseMask("Ellipse mask", {
    kind: "ellipse",
    center: staticValue(center),
    radii: staticValue(radii),
    rotation: staticValue(0),
  });
}

/** A polygon/pen path. `handles` defaults to empty (straight segments). */
export function createPathMask(vertices: Vec2[], closed = true): Mask {
  return baseMask("Path mask", {
    kind: "path",
    vertices: vertices.map((vertex) => staticValue(vertex)),
    handles: vertices.map(() => ({ in: { x: 0, y: 0 }, out: { x: 0, y: 0 } })),
    closed,
  });
}

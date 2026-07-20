/**
 * Animation model.
 *
 * The central abstraction is the {@link Animatable}: a value that is *either* a
 * constant or a keyframed track. Every property on every object is declared as
 * `Animatable<T>`, which is what makes "every property is animatable" true by
 * construction rather than by convention — there is no place in the document to
 * put a value that a keyframe cannot reach.
 */

import type { Frame, Unit, Vec2 } from "./primitives";

/** Interpolation applied on the segment *leaving* a keyframe. */
export type EasingKind = "hold" | "linear" | "ease-in" | "ease-out" | "ease-in-out" | "bezier" | "spring";

/**
 * A cubic-bezier timing curve, expressed as its two control points.
 * Matches the CSS `cubic-bezier(x1, y1, x2, y2)` convention.
 */
export interface BezierEasing {
  kind: "bezier";
  p1: Vec2;
  p2: Vec2;
}

/**
 * Physical spring easing. Duration is emergent (solved until the spring
 * settles) rather than authored, which is why it carries no control points.
 */
export interface SpringEasing {
  kind: "spring";
  stiffness: number;
  damping: number;
  mass: number;
}

export interface SimpleEasing {
  kind: Exclude<EasingKind, "bezier" | "spring">;
}

export type Easing = SimpleEasing | BezierEasing | SpringEasing;

export const EASING_LINEAR: Easing = { kind: "linear" };

export interface Keyframe<T> {
  frame: Frame;
  value: T;
  /** Easing used to travel from *this* keyframe to the next one. */
  easing: Easing;
}

/** A constant value — the common case, kept cheap and allocation-free. */
export interface StaticValue<T> {
  type: "static";
  value: T;
}

/** A keyframed track. Keyframes are kept sorted by `frame` at all times. */
export interface AnimatedValue<T> {
  type: "animated";
  keyframes: Keyframe<T>[];
}

export type Animatable<T> = StaticValue<T> | AnimatedValue<T>;

export function staticValue<T>(value: T): StaticValue<T> {
  return { type: "static", value };
}

export function isAnimated<T>(value: Animatable<T>): value is AnimatedValue<T> {
  return value.type === "animated";
}

/**
 * A reusable, named animation applied to an object (Fade, Pop, Slide, …).
 *
 * Presets are *authored as data*, not code, so that plugins and community packs
 * can ship new ones as JSON with no rebuild. Applying a preset expands it into
 * real keyframes on the target properties — presets are a UI affordance, never a
 * hidden runtime layer, which keeps the render path free of special cases.
 */
export interface AnimationPreset {
  id: string;
  name: string;
  category: "in" | "out" | "emphasis" | "motion";
  /** Duration the preset was authored at; scaled when applied. */
  baseDurationFrames: number;
  /** Property path -> keyframes, with frames relative to preset start. */
  tracks: Record<string, Keyframe<unknown>[]>;
}

/** A path an object travels along, independent of its other transforms. */
export interface MotionPath {
  points: Vec2[];
  /** Bezier control handles, one pair per point; empty means polyline. */
  handles: { in: Vec2; out: Vec2 }[];
  closed: boolean;
  /** Rotate the object to face along the path tangent. */
  orientToPath: boolean;
  /** Animatable progress along the path, 0..1. */
  progress: Animatable<Unit>;
}

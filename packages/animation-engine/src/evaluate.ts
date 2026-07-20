/**
 * Evaluating animatable values at a point in time.
 *
 * This is the single function the renderer calls for every property of every
 * object on every frame, so it is deliberately allocation-free on the common
 * path (a static value returns immediately) and uses binary search rather than
 * a scan once a track has keyframes.
 */

import type { Animatable, Frame, Keyframe } from "@opencut/types";
import { applyEasing } from "./easing";
import { interpolate } from "./interpolate";

/**
 * Finds the index of the last keyframe at or before `frame`.
 *
 * Binary search, not a linear scan: a heavily animated property can carry
 * hundreds of keyframes, and this runs for every property on every frame.
 * Returns -1 when `frame` precedes the first keyframe.
 */
export function findKeyframeIndex<T>(keyframes: readonly Keyframe<T>[], frame: Frame): number {
  let low = 0;
  let high = keyframes.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const candidate = keyframes[mid];
    if (!candidate) break;

    if (candidate.frame <= frame) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

/**
 * Resolves an animatable property to its value at `frame`.
 *
 * Outside the keyframe range the value is *clamped* to the nearest keyframe
 * rather than extrapolated. Extrapolating a scale or opacity past its last
 * keyframe produces objects that silently grow forever or turn invisible — a
 * held value is always what the author meant.
 */
export function evaluate<T>(animatable: Animatable<T>, frame: Frame): T {
  if (animatable.type === "static") return animatable.value;

  const { keyframes } = animatable;
  if (keyframes.length === 0) {
    throw new Error("Animated value has no keyframes");
  }

  const first = keyframes[0]!;
  if (keyframes.length === 1 || frame <= first.frame) return first.value;

  const last = keyframes[keyframes.length - 1]!;
  if (frame >= last.frame) return last.value;

  const index = findKeyframeIndex(keyframes, frame);
  const from = keyframes[index];
  const to = keyframes[index + 1];
  if (!from) return first.value;
  if (!to) return from.value;

  const span = to.frame - from.frame;
  // Coincident keyframes would divide by zero; the later value wins, which is
  // what a zero-length segment means.
  if (span <= 0) return to.value;

  const progress = (frame - from.frame) / span;
  const eased = applyEasing(from.easing, progress);

  return interpolate(from.value, to.value, eased);
}

/** Sorts keyframes by frame. The evaluator assumes sorted input. */
export function sortKeyframes<T>(keyframes: readonly Keyframe<T>[]): Keyframe<T>[] {
  return [...keyframes].sort((a, b) => a.frame - b.frame);
}

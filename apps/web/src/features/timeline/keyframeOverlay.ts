import type { Clip, Frame } from "@opencut/types";
import {
  hasKeyframeAt,
  keyframeFrames,
  moveKeyframe,
  removeKeyframe,
} from "@opencut/animation-engine";
import { propertiesForClip } from "@/features/properties/propertySchema";
import type { ClipRect, TimelineViewport } from "./geometry";
import { frameToX } from "./geometry";

/**
 * Keyframe overlay data for the timeline.
 *
 * The inline timeline shows one keyframe row per clip — the *union* of every
 * animated property's keyframe times — rather than a full per-property
 * dopesheet, which would overflow a clip lane. The per-property breakdown
 * belongs in an expandable panel, a later refinement; a single row already
 * answers the question the timeline is for: "where does this clip have
 * animation?"
 *
 * Pure: no canvas, no React. Rendering and interaction consume this.
 */

/** Distinct keyframe frames across all of a clip's animated properties, sorted. */
export function unionKeyframeFrames(clip: Clip): Frame[] {
  const frames = new Set<Frame>();

  for (const descriptor of propertiesForClip(clip)) {
    const animatable = descriptor.get(clip);
    if (!animatable || animatable.type !== "animated") continue;
    for (const frame of keyframeFrames(animatable)) frames.add(frame);
  }

  return [...frames].sort((a, b) => a - b);
}

export function hasAnimation(clip: Clip): boolean {
  return unionKeyframeFrames(clip).length > 0;
}

/**
 * Geometry of the keyframe row on a clip.
 *
 * Kept next to the interaction helpers, and mirrored by the renderer, so the
 * drawn diamond and its grab target never drift apart — a mismatch there makes
 * keyframes feel impossible to grab.
 */
export const KEYFRAME_ROW_BOTTOM_OFFSET = 6;
/** Grab radius in pixels, larger than the drawn diamond (Fitts's law). */
export const KEYFRAME_HIT_RADIUS = 7;

/** Y of the keyframe row centre within a clip rect. */
export function keyframeRowY(rect: ClipRect): number {
  return rect.y + rect.height - KEYFRAME_ROW_BOTTOM_OFFSET;
}

/**
 * Finds the keyframe frame under a point, or null.
 *
 * Tests against the union frames of the clip the rect belongs to. Returns the
 * nearest within the grab radius so densely packed diamonds resolve to the one
 * the pointer is actually over.
 */
export function hitTestKeyframe(
  px: number,
  py: number,
  clip: Clip,
  rect: ClipRect,
  viewport: TimelineViewport,
): Frame | null {
  const rowY = keyframeRowY(rect);
  if (Math.abs(py - rowY) > KEYFRAME_HIT_RADIUS) return null;

  let best: Frame | null = null;
  let bestDx = KEYFRAME_HIT_RADIUS;

  for (const frame of unionKeyframeFrames(clip)) {
    const dx = Math.abs(frameToX(frame, viewport) - px);
    if (dx <= bestDx) {
      best = frame;
      bestDx = dx;
    }
  }

  return best;
}

/**
 * Retimes every property keyframed at `fromFrame` to `toFrame`.
 *
 * The union row represents all properties sharing that instant, so dragging the
 * diamond moves them together — which is what a user manipulating "the keyframe
 * at 2 seconds" expects, rather than silently splitting properties apart.
 */
export function moveKeyframesAtFrame(clip: Clip, fromFrame: Frame, toFrame: Frame): Clip {
  if (fromFrame === toFrame) return clip;

  let next = clip;
  for (const descriptor of propertiesForClip(clip)) {
    const animatable = descriptor.get(next);
    if (!animatable || !hasKeyframeAt(animatable, fromFrame)) continue;
    next = descriptor.set(next, moveKeyframe(animatable, fromFrame, toFrame));
  }
  return next;
}

/** Removes every keyframe at `frame` across the clip's properties. */
export function removeKeyframesAtFrame(clip: Clip, frame: Frame): Clip {
  let next = clip;
  for (const descriptor of propertiesForClip(clip)) {
    const animatable = descriptor.get(next);
    if (!animatable || !hasKeyframeAt(animatable, frame)) continue;
    next = descriptor.set(next, removeKeyframe(animatable, frame));
  }
  return next;
}

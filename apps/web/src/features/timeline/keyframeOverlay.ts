import type { Clip, Frame } from "@opencut/types";
import { keyframeFrames } from "@opencut/animation-engine";
import { propertiesForClip } from "@/features/properties/propertySchema";

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

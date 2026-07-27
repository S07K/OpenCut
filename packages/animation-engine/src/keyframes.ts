/**
 * Keyframe editing.
 *
 * Pure operations on `Animatable<T>`: they take an animatable and return a new
 * one, never mutating. This is what lets the store treat a keyframe edit like
 * any other document change — snapshot it, undo it, serialize it — with no
 * special cases.
 *
 * The evaluator (`evaluate.ts`) assumes keyframes are sorted by frame at all
 * times. Every function here preserves that invariant, so nothing downstream
 * ever has to re-sort on the hot path.
 */

import type { Animatable, AnimatedValue, Easing, Frame, Keyframe } from "@opencut/types";
import { EASING_LINEAR } from "@opencut/types";

/** Inserts sorted, or replaces an existing keyframe on the exact frame. */
function upsertKeyframe<T>(keyframes: readonly Keyframe<T>[], next: Keyframe<T>): Keyframe<T>[] {
  const result: Keyframe<T>[] = [];
  let inserted = false;

  for (const existing of keyframes) {
    if (existing.frame === next.frame) {
      // Same frame → replace. Two keyframes on one frame would make the segment
      // between them zero-length and the animation ambiguous.
      result.push(next);
      inserted = true;
    } else if (!inserted && existing.frame > next.frame) {
      result.push(next, existing);
      inserted = true;
    } else {
      result.push(existing);
    }
  }

  if (!inserted) result.push(next);
  return result;
}

/**
 * Sets a keyframe at `frame`, promoting a static value to an animated track.
 *
 * When the value is currently static, its constant is preserved as the value of
 * any *existing* implicit state — but a single keyframe is all we add, because
 * one keyframe evaluates to that constant everywhere anyway. The property only
 * truly animates once it has a second keyframe.
 */
export function setKeyframe<T>(
  animatable: Animatable<T>,
  frame: Frame,
  value: T,
  easing: Easing = EASING_LINEAR,
): AnimatedValue<T> {
  const keyframe: Keyframe<T> = { frame, value, easing };

  if (animatable.type === "static") {
    return { type: "animated", keyframes: [keyframe] };
  }

  return { type: "animated", keyframes: upsertKeyframe(animatable.keyframes, keyframe) };
}

/**
 * Removes the keyframe at `frame`.
 *
 * When the last keyframe is removed the track collapses back to a static value,
 * holding whatever it evaluated to — an animated value with zero keyframes is
 * illegal (the evaluator throws on it), and silently keeping an empty track
 * would be a landmine.
 */
export function removeKeyframe<T>(animatable: Animatable<T>, frame: Frame): Animatable<T> {
  if (animatable.type === "static") return animatable;

  const remaining = animatable.keyframes.filter((keyframe) => keyframe.frame !== frame);

  if (remaining.length === 0) {
    // Fall back to the removed frame's value, or the first surviving one.
    const removed = animatable.keyframes.find((keyframe) => keyframe.frame === frame);
    const fallback = removed ?? animatable.keyframes[0];
    return { type: "static", value: fallback!.value };
  }

  if (remaining.length === animatable.keyframes.length) return animatable;
  return { type: "animated", keyframes: remaining };
}

/**
 * Moves a keyframe from one frame to another.
 *
 * If the destination already holds a keyframe it is overwritten — dragging one
 * keyframe onto another is a merge, matching every timeline editor's behaviour.
 */
export function moveKeyframe<T>(
  animatable: Animatable<T>,
  fromFrame: Frame,
  toFrame: Frame,
): Animatable<T> {
  if (animatable.type === "static" || fromFrame === toFrame) return animatable;

  const source = animatable.keyframes.find((keyframe) => keyframe.frame === fromFrame);
  if (!source) return animatable;

  const withoutSource = animatable.keyframes.filter((keyframe) => keyframe.frame !== fromFrame);
  return {
    type: "animated",
    keyframes: upsertKeyframe(withoutSource, { ...source, frame: toFrame }),
  };
}

/** Replaces the value at an existing keyframe, or the whole static value. */
export function setValueAt<T>(animatable: Animatable<T>, frame: Frame, value: T): Animatable<T> {
  if (animatable.type === "static") return { type: "static", value };

  const existing = animatable.keyframes.find((keyframe) => keyframe.frame === frame);
  // Editing a property while the playhead sits between keyframes adds a new one
  // rather than silently changing a neighbour — the value the user sees is the
  // value they mean to pin.
  if (!existing) return setKeyframe(animatable, frame, value);

  return {
    type: "animated",
    keyframes: animatable.keyframes.map((keyframe) =>
      keyframe.frame === frame ? { ...keyframe, value } : keyframe,
    ),
  };
}

/** Changes the easing that leaves a given keyframe. */
export function setKeyframeEasing<T>(
  animatable: Animatable<T>,
  frame: Frame,
  easing: Easing,
): Animatable<T> {
  if (animatable.type === "static") return animatable;

  return {
    type: "animated",
    keyframes: animatable.keyframes.map((keyframe) =>
      keyframe.frame === frame ? { ...keyframe, easing } : keyframe,
    ),
  };
}

/** Collapses a track to a constant, discarding all keyframes. */
export function toStatic<T>(value: T): Animatable<T> {
  return { type: "static", value };
}

export function hasKeyframeAt<T>(animatable: Animatable<T>, frame: Frame): boolean {
  return (
    animatable.type === "animated" &&
    animatable.keyframes.some((keyframe) => keyframe.frame === frame)
  );
}

export function isAnimatedTrack<T>(animatable: Animatable<T>): boolean {
  return animatable.type === "animated" && animatable.keyframes.length > 1;
}

/** All keyframe frames on a track, ascending. Empty for a static value. */
export function keyframeFrames<T>(animatable: Animatable<T>): Frame[] {
  return animatable.type === "animated" ? animatable.keyframes.map((k) => k.frame) : [];
}

import type { Clip, Vec2 } from "@opencut/types";
import { evaluate, setKeyframe } from "@opencut/animation-engine";
import { propertiesForClip, type PropertyDescriptor } from "@/features/properties/propertySchema";
import type { AnimationPreset, PresetValue } from "./presets";

/**
 * Expands a preset into real keyframes on a clip.
 *
 * Pure: takes a clip, returns a new clip. The window is placed by category —
 * entrance at the clip's head, exit at its tail — and clamped to the clip so a
 * long preset on a short clip still fits. Resting values are read from the
 * property's value at the window's *start*, so `multiply`/`offset` presets ramp
 * relative to where the clip actually sits rather than to hardcoded defaults.
 */
export function applyPreset(clip: Clip, preset: AnimationPreset): Clip {
  const descriptors = new Map(propertiesForClip(clip).map((d) => [d.id, d]));

  // Clamp the window to the clip; an entrance longer than the clip would place
  // keyframes past its end where they never play.
  const window = Math.min(preset.durationFrames, Math.max(1, clip.durationFrames - 1));

  const clipStart = clip.startFrame;
  const clipEnd = clip.startFrame + clip.durationFrames;
  const windowStart = preset.category === "out" ? clipEnd - window : clipStart;

  let next = clip;

  for (const channel of preset.channels) {
    const descriptor = descriptors.get(channel.propertyId);
    if (!descriptor) continue;

    const current = descriptor.get(next);
    if (!current) continue;

    // Resting value sampled once, at the window start, so every keyframe in the
    // channel is relative to a single stable baseline.
    const resting = evaluate(current, windowStart);

    let animatable = current;
    for (const keyframe of channel.keyframes) {
      const frame = Math.round(windowStart + keyframe.at * window);
      const value = resolvePresetValue(keyframe.value, resting);
      animatable = setKeyframe(animatable, frame, value, keyframe.easing);
    }

    next = descriptor.set(next, animatable);
  }

  return next;
}

/** Resolves a preset value against the property's resting value. */
function resolvePresetValue(value: PresetValue, resting: unknown): unknown {
  switch (value.mode) {
    case "absolute":
      return value.scalar;

    case "absolute-vec":
      return value.vec;

    case "multiply":
      if (isVec2(resting)) {
        return { x: resting.x * value.scalar, y: resting.y * value.scalar };
      }
      return typeof resting === "number" ? resting * value.scalar : value.scalar;

    case "offset":
      if (isVec2(resting)) {
        return { x: resting.x + value.vec.x, y: resting.y + value.vec.y };
      }
      // A vector offset applied to a scalar property is meaningless; fall back
      // to the resting value rather than producing a nonsense number.
      return resting;

    default:
      return resting;
  }
}

function isVec2(value: unknown): value is Vec2 {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Vec2).x === "number" &&
    typeof (value as Vec2).y === "number"
  );
}

/** Presets applicable to a clip — those whose channels it has properties for. */
export function applicablePresets(
  clip: Clip,
  presets: readonly AnimationPreset[],
): AnimationPreset[] {
  const ids = new Set(propertiesForClip(clip).map((d) => d.id));
  return presets.filter((preset) => preset.channels.some((c) => ids.has(c.propertyId)));
}

export type { PropertyDescriptor };

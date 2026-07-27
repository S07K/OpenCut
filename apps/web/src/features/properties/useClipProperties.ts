"use client";

import { useCallback } from "react";
import type { Animatable, Clip, Frame } from "@opencut/types";
import {
  evaluate,
  hasKeyframeAt,
  isAnimatedTrack,
  removeKeyframe,
  setKeyframe,
  setValueAt,
  toStatic,
} from "@opencut/animation-engine";
import { useEditorStore } from "@/state/editorStore";
import type { PropertyDescriptor } from "./propertySchema";

/**
 * Editing a clip's animatable properties.
 *
 * This hook is where the property schema, the pure keyframe operations, and the
 * store's generic `updateClip` meet. Components call these methods; none of them
 * touches an `Animatable` directly, so the "is this property keyframed at the
 * playhead" logic lives in exactly one place.
 */
export interface ClipPropertyApi {
  /** Current value of a property at the playhead. */
  valueAt: (clip: Clip, descriptor: PropertyDescriptor) => unknown;
  /** True when the track carries a keyframe on the current frame. */
  isKeyframedHere: (clip: Clip, descriptor: PropertyDescriptor) => boolean;
  /** True when the property varies over time (two or more keyframes). */
  isAnimated: (clip: Clip, descriptor: PropertyDescriptor) => boolean;
  /**
   * Sets a property value.
   *
   * When the property is already animated, this pins a keyframe at the playhead
   * — editing an animated property must not silently flatten it. When it is
   * static, it just replaces the constant.
   */
  setValue: (clipId: string, descriptor: PropertyDescriptor, value: unknown) => void;
  /** Adds (or, if present, removes) a keyframe at the playhead. */
  toggleKeyframe: (clipId: string, descriptor: PropertyDescriptor) => void;
  endEdit: () => void;
}

export function useClipProperties(): ClipPropertyApi {
  const updateClip = useEditorStore((state) => state.updateClip);
  const endGesture = useEditorStore((state) => state.endGesture);

  const valueAt = useCallback((clip: Clip, descriptor: PropertyDescriptor): unknown => {
    const animatable = descriptor.get(clip);
    if (!animatable) return null;
    return evaluate(animatable, useEditorStore.getState().playhead);
  }, []);

  const isKeyframedHere = useCallback((clip: Clip, descriptor: PropertyDescriptor): boolean => {
    const animatable = descriptor.get(clip);
    return animatable ? hasKeyframeAt(animatable, useEditorStore.getState().playhead) : false;
  }, []);

  const isAnimated = useCallback((clip: Clip, descriptor: PropertyDescriptor): boolean => {
    const animatable = descriptor.get(clip);
    return animatable ? isAnimatedTrack(animatable) : false;
  }, []);

  const setValue = useCallback(
    (clipId: string, descriptor: PropertyDescriptor, value: unknown) => {
      const frame: Frame = useEditorStore.getState().playhead;

      updateClip(
        clipId,
        (clip) => {
          const current = descriptor.get(clip);
          if (!current) return clip;

          const next: Animatable<unknown> =
            current.type === "animated" ? setValueAt(current, frame, value) : toStatic(value);

          return descriptor.set(clip, next);
        },
        `Edit ${descriptor.label.toLowerCase()}`,
        // Merge continuous scrubbing of one property into a single undo step.
        `prop:${clipId}:${descriptor.id}`,
      );
    },
    [updateClip],
  );

  const toggleKeyframe = useCallback(
    (clipId: string, descriptor: PropertyDescriptor) => {
      const frame: Frame = useEditorStore.getState().playhead;

      updateClip(
        clipId,
        (clip) => {
          const current = descriptor.get(clip);
          if (!current) return clip;

          if (hasKeyframeAt(current, frame)) {
            return descriptor.set(clip, removeKeyframe(current, frame));
          }

          // Pin the property's *current displayed value* — the value the user
          // sees is the one they mean to lock in.
          const value = evaluate(current, frame);
          return descriptor.set(clip, setKeyframe(current, frame, value));
        },
        `Toggle ${descriptor.label.toLowerCase()} keyframe`,
      );
    },
    [updateClip],
  );

  return { valueAt, isKeyframedHere, isAnimated, setValue, toggleKeyframe, endEdit: endGesture };
}

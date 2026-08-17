import type { Easing } from "@cutaway/types";

/**
 * Animation presets — authored as data.
 *
 * A preset is a list of channels, each targeting a property by the same id the
 * property schema uses, with keyframes placed at fractional positions (0..1)
 * within an application window. Applying one expands it into real keyframes on
 * the clip, so presets are a pure authoring convenience — the render path never
 * sees a "preset", only ordinary keyframes. That is what lets the community ship
 * presets as JSON with no code, and what keeps the plugin SDK's job small.
 *
 * The value model is the crux. A Fade uses absolute opacity values, but a Pop
 * must scale *to the clip's current scale* (an imported image is fit-scaled to,
 * say, 4.8 — not 1), and a Slide offsets *from the clip's current position*. So
 * a preset value is one of:
 *
 * - `absolute` — use the literal value.
 * - `multiply` — value × the clip's resting value (scale from nothing to its
 *   real size).
 * - `offset`  — value + the clip's resting value (slide in from beside it).
 */

export type PresetValue =
  | { mode: "absolute"; scalar: number }
  | { mode: "multiply"; scalar: number }
  | { mode: "offset"; vec: { x: number; y: number } }
  | { mode: "absolute-vec"; vec: { x: number; y: number } };

export interface PresetKeyframe {
  /** Position within the application window, 0..1. */
  at: number;
  value: PresetValue;
  /** Easing leaving this keyframe. */
  easing: Easing;
}

export interface PresetChannel {
  /** Matches a PropertyDescriptor id, e.g. "appearance.opacity". */
  propertyId: string;
  keyframes: PresetKeyframe[];
}

export interface AnimationPreset {
  id: string;
  name: string;
  /** Where the window sits: entrance, exit, or across the clip. */
  category: "in" | "out" | "emphasis";
  /** Window length in frames; clamped to the clip when applied. */
  durationFrames: number;
  channels: PresetChannel[];
}

const linear: Easing = { kind: "linear" };
const easeOut: Easing = { kind: "ease-out" };
const easeInOut: Easing = { kind: "ease-in-out" };
const spring: Easing = { kind: "spring", stiffness: 180, damping: 12, mass: 1 };

/**
 * The built-in preset library.
 *
 * Deliberately small and legible — each is a few keyframes. New presets are
 * added here (or, later, loaded from JSON) without touching any apply logic.
 */
export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: "core.fade-in",
    name: "Fade In",
    category: "in",
    durationFrames: 15,
    channels: [
      {
        propertyId: "appearance.opacity",
        keyframes: [
          { at: 0, value: { mode: "absolute", scalar: 0 }, easing: easeOut },
          { at: 1, value: { mode: "absolute", scalar: 1 }, easing: linear },
        ],
      },
    ],
  },
  {
    id: "core.fade-out",
    name: "Fade Out",
    category: "out",
    durationFrames: 15,
    channels: [
      {
        propertyId: "appearance.opacity",
        keyframes: [
          { at: 0, value: { mode: "absolute", scalar: 1 }, easing: easeInOut },
          { at: 1, value: { mode: "absolute", scalar: 0 }, easing: linear },
        ],
      },
    ],
  },
  {
    id: "core.pop-in",
    name: "Pop In",
    category: "in",
    durationFrames: 20,
    channels: [
      {
        // Multiply, so the clip pops up to its real resting scale, whatever
        // that is, with a spring overshoot.
        propertyId: "transform.scale",
        keyframes: [
          { at: 0, value: { mode: "multiply", scalar: 0 }, easing: spring },
          { at: 1, value: { mode: "multiply", scalar: 1 }, easing: linear },
        ],
      },
      {
        propertyId: "appearance.opacity",
        keyframes: [
          { at: 0, value: { mode: "absolute", scalar: 0 }, easing: easeOut },
          { at: 0.4, value: { mode: "absolute", scalar: 1 }, easing: linear },
        ],
      },
    ],
  },
  {
    id: "core.slide-in-left",
    name: "Slide In",
    category: "in",
    durationFrames: 18,
    channels: [
      {
        // Offset from the resting position: start one-third of the frame width
        // to the left, settle at the real position.
        propertyId: "transform.position",
        keyframes: [
          { at: 0, value: { mode: "offset", vec: { x: -640, y: 0 } }, easing: easeOut },
          { at: 1, value: { mode: "offset", vec: { x: 0, y: 0 } }, easing: linear },
        ],
      },
      {
        propertyId: "appearance.opacity",
        keyframes: [
          { at: 0, value: { mode: "absolute", scalar: 0 }, easing: easeOut },
          { at: 0.6, value: { mode: "absolute", scalar: 1 }, easing: linear },
        ],
      },
    ],
  },
  {
    id: "core.pop-out",
    name: "Pop Out",
    category: "out",
    durationFrames: 16,
    channels: [
      {
        propertyId: "transform.scale",
        keyframes: [
          { at: 0, value: { mode: "multiply", scalar: 1 }, easing: easeInOut },
          { at: 1, value: { mode: "multiply", scalar: 0 }, easing: linear },
        ],
      },
      {
        propertyId: "appearance.opacity",
        keyframes: [
          { at: 0.4, value: { mode: "absolute", scalar: 1 }, easing: easeInOut },
          { at: 1, value: { mode: "absolute", scalar: 0 }, easing: linear },
        ],
      },
    ],
  },
];

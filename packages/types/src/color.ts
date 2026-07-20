/**
 * Color grading model.
 *
 * Every field is animatable, which means a grade can ramp over time (e.g. a
 * flash-to-white transition) without a separate effect existing.
 */

import type { Animatable } from "./animation";
import type { Unit, Vec2 } from "./primitives";

/** A single control point on a tone curve, in normalized 0..1 space. */
export type CurvePoint = Vec2;

export interface ToneCurves {
  master: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

/** Lift/gamma/gain wheel: a hue offset plus a master level. */
export interface ColorWheel {
  /** Offset in RGB space, each component -1..1. */
  offset: Animatable<Vec2>;
  level: Animatable<number>;
}

export interface ColorGrade {
  enabled: boolean;

  // Tonal — all normalized to -1..1 with 0 meaning "unchanged", so that the
  // UI sliders, the shader uniforms, and the JSON all agree on neutral.
  brightness: Animatable<number>;
  contrast: Animatable<number>;
  exposure: Animatable<number>;
  shadows: Animatable<number>;
  highlights: Animatable<number>;
  whites: Animatable<number>;
  blacks: Animatable<number>;

  // Chromatic
  temperature: Animatable<number>;
  tint: Animatable<number>;
  saturation: Animatable<number>;
  vibrance: Animatable<number>;

  curves: ToneCurves;
  wheels: {
    lift: ColorWheel;
    gamma: ColorWheel;
    gain: ColorWheel;
  };

  vignette: {
    amount: Animatable<number>;
    radius: Animatable<Unit>;
    softness: Animatable<Unit>;
  };

  grain: {
    amount: Animatable<number>;
    size: Animatable<number>;
  };
}

/**
 * Color grade evaluation.
 *
 * Resolves a `ColorGrade` — a bag of animatable fields — into a flat set of
 * plain numbers at a frame, ready to hand to a shader as uniforms. Pure and
 * DOM-free: it decides *what* the grade values are; the compositor's shader
 * decides *how* to apply them, the same what/how split as the rest of
 * rendering, so preview and export grade identically.
 */

import type { ColorGrade, Vec2 } from "@cutaway/types";
import { evaluate } from "@cutaway/animation-engine";

/** A colour wheel resolved to concrete numbers. */
export interface ResolvedWheel {
  offset: Vec2;
  level: number;
}

/**
 * A grade resolved for one frame.
 *
 * Every tonal/chromatic field is normalized to the same convention as the
 * document: 0 means "unchanged", range roughly -1..1. The shader is written
 * against exactly these names, so there is one vocabulary from slider to JSON
 * to uniform.
 */
export interface ResolvedGrade {
  brightness: number;
  contrast: number;
  exposure: number;
  shadows: number;
  highlights: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  wheels: { lift: ResolvedWheel; gamma: ResolvedWheel; gain: ResolvedWheel };
  vignette: { amount: number; radius: number; softness: number };
  grain: { amount: number; size: number };
}

function resolveWheel(wheel: ColorGrade["wheels"]["lift"], frame: number): ResolvedWheel {
  return { offset: evaluate(wheel.offset, frame), level: evaluate(wheel.level, frame) };
}

export function resolveGrade(grade: ColorGrade, frame: number): ResolvedGrade {
  return {
    brightness: evaluate(grade.brightness, frame),
    contrast: evaluate(grade.contrast, frame),
    exposure: evaluate(grade.exposure, frame),
    shadows: evaluate(grade.shadows, frame),
    highlights: evaluate(grade.highlights, frame),
    whites: evaluate(grade.whites, frame),
    blacks: evaluate(grade.blacks, frame),
    temperature: evaluate(grade.temperature, frame),
    tint: evaluate(grade.tint, frame),
    saturation: evaluate(grade.saturation, frame),
    vibrance: evaluate(grade.vibrance, frame),
    wheels: {
      lift: resolveWheel(grade.wheels.lift, frame),
      gamma: resolveWheel(grade.wheels.gamma, frame),
      gain: resolveWheel(grade.wheels.gain, frame),
    },
    vignette: {
      amount: evaluate(grade.vignette.amount, frame),
      radius: evaluate(grade.vignette.radius, frame),
      softness: evaluate(grade.vignette.softness, frame),
    },
    grain: {
      amount: evaluate(grade.grain.amount, frame),
      size: evaluate(grade.grain.size, frame),
    },
  };
}

const NEUTRAL_EPSILON = 1e-4;

function isZero(n: number): boolean {
  return Math.abs(n) < NEUTRAL_EPSILON;
}

function wheelIsNeutral(wheel: ResolvedWheel): boolean {
  return isZero(wheel.offset.x) && isZero(wheel.offset.y) && isZero(wheel.level);
}

/**
 * True when a resolved grade would leave every pixel untouched.
 *
 * The compositor checks this to skip the colour filter entirely on an
 * unmodified grade — most clips are never graded, and running a full-frame
 * shader pass that does nothing is pure waste on the render hot path.
 */
export function isNeutralGrade(grade: ResolvedGrade): boolean {
  return (
    isZero(grade.brightness) &&
    isZero(grade.contrast) &&
    isZero(grade.exposure) &&
    isZero(grade.shadows) &&
    isZero(grade.highlights) &&
    isZero(grade.whites) &&
    isZero(grade.blacks) &&
    isZero(grade.temperature) &&
    isZero(grade.tint) &&
    isZero(grade.saturation) &&
    isZero(grade.vibrance) &&
    wheelIsNeutral(grade.wheels.lift) &&
    wheelIsNeutral(grade.wheels.gamma) &&
    wheelIsNeutral(grade.wheels.gain) &&
    isZero(grade.vignette.amount) &&
    isZero(grade.grain.amount)
  );
}

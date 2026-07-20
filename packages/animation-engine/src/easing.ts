/**
 * Easing functions.
 *
 * Each maps normalized progress `t` in [0, 1] to eased progress. Pure, and
 * exact enough that an animation authored here matches what After Effects or
 * CSS would produce — creators move between tools and notice when curves differ.
 */

import type { Easing } from "@opencut/types";

export function linear(t: number): number {
  return t;
}

export function easeIn(t: number): number {
  return t * t;
}

export function easeOut(t: number): number {
  return t * (2 - t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** One axis of a cubic bezier with implicit endpoints at 0 and 1. */
function bezierAxis(t: number, a: number, b: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t * t * t;
}

function bezierAxisDerivative(t: number, a: number, b: number): number {
  const inverse = 1 - t;
  return (
    3 * inverse * inverse * a +
    6 * inverse * t * (b - a) +
    3 * t * t * (1 - b)
  );
}

const BEZIER_ITERATIONS = 8;
const BEZIER_EPSILON = 1e-6;

/**
 * Evaluates a CSS-style `cubic-bezier(x1, y1, x2, y2)` curve at `t`.
 *
 * The curve is parametric, so finding `y` for a given `x` means solving for the
 * parameter first. Newton-Raphson converges in a handful of iterations, with a
 * bisection fallback for the pathological curves where the derivative
 * approaches zero and Newton would shoot off.
 */
export function cubicBezier(t: number, x1: number, y1: number, x2: number, y2: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // A curve whose control points lie on the diagonal is the identity; skipping
  // the solve here is both faster and exactly correct.
  if (x1 === y1 && x2 === y2) return t;

  let guess = t;
  for (let index = 0; index < BEZIER_ITERATIONS; index += 1) {
    const currentX = bezierAxis(guess, x1, x2) - t;
    if (Math.abs(currentX) < BEZIER_EPSILON) return bezierAxis(guess, y1, y2);

    const derivative = bezierAxisDerivative(guess, x1, x2);
    if (Math.abs(derivative) < BEZIER_EPSILON) break;
    guess -= currentX / derivative;
  }

  let low = 0;
  let high = 1;
  guess = t;
  while (high - low > BEZIER_EPSILON) {
    const currentX = bezierAxis(guess, x1, x2);
    if (currentX < t) low = guess;
    else high = guess;
    guess = (low + high) / 2;
  }

  return bezierAxis(guess, y1, y2);
}

/**
 * Damped-harmonic spring, sampled at normalized progress `t`.
 *
 * A real spring has no fixed duration — it settles asymptotically. Since the
 * timeline needs a bounded segment, `t` is treated as normalized time across
 * whatever gap the keyframes define, and the spring is evaluated over a fixed
 * simulated window. That keeps springs authorable on a timeline while still
 * producing genuine overshoot rather than a fake bounce curve.
 */
export function spring(t: number, stiffness: number, damping: number, mass: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const safeMass = Math.max(mass, 0.0001);
  const angularFrequency = Math.sqrt(Math.max(stiffness, 0) / safeMass);
  const dampingRatio = damping / (2 * Math.sqrt(Math.max(stiffness, 0) * safeMass));

  // Simulated seconds represented by the full segment. Chosen so default
  // spring parameters settle close to 1 by the end of the segment.
  const time = t * 1.2;

  if (dampingRatio < 1) {
    // Underdamped — the interesting case, with overshoot.
    const dampedFrequency = angularFrequency * Math.sqrt(1 - dampingRatio * dampingRatio);
    const decay = Math.exp(-dampingRatio * angularFrequency * time);
    return (
      1 -
      decay *
        (Math.cos(dampedFrequency * time) +
          ((dampingRatio * angularFrequency) / dampedFrequency) *
            Math.sin(dampedFrequency * time))
    );
  }

  // Critically or over-damped: approaches the target without crossing it.
  const decay = Math.exp(-angularFrequency * time);
  return 1 - decay * (1 + angularFrequency * time);
}

export const DEFAULT_SPRING = { stiffness: 180, damping: 12, mass: 1 } as const;

/** Applies an easing descriptor to normalized progress. */
export function applyEasing(easing: Easing, t: number): number {
  switch (easing.kind) {
    case "hold":
      // Holds the previous keyframe's value until the next one is reached —
      // the basis of step animation and of non-interpolatable properties.
      return 0;
    case "linear":
      return linear(t);
    case "ease-in":
      return easeIn(t);
    case "ease-out":
      return easeOut(t);
    case "ease-in-out":
      return easeInOut(t);
    case "bezier":
      return cubicBezier(t, easing.p1.x, easing.p1.y, easing.p2.x, easing.p2.y);
    case "spring":
      return spring(t, easing.stiffness, easing.damping, easing.mass);
    default:
      return linear(t);
  }
}

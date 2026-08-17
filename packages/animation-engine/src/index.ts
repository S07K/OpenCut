/**
 * `@cutaway/animation-engine` — evaluating animated properties over time.
 *
 * Pure math. No React, no DOM, no canvas. The renderer and the exporter both
 * call `evaluate` for every property on every frame, so everything here is on
 * the hot path and written accordingly.
 */

export * from "./easing";
export * from "./interpolate";
export * from "./evaluate";
export * from "./keyframes";

/**
 * `@opencut/types` — the shared domain vocabulary.
 *
 * This package has **zero dependencies** and contains no runtime logic beyond a
 * handful of constructors and predicates. Every other package depends on it;
 * it depends on nothing. That acyclic root is what keeps the engines
 * independently testable and independently publishable.
 */

export * from "./primitives.js";
export * from "./animation.js";
export * from "./mask.js";
export * from "./color.js";
export * from "./effects.js";
export * from "./objects.js";
export * from "./timeline.js";
export * from "./media.js";
export * from "./caption.js";
export * from "./project.js";

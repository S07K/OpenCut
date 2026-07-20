/**
 * `@opencut/types` — the shared domain vocabulary.
 *
 * This package has **zero dependencies** and contains no runtime logic beyond a
 * handful of constructors and predicates. Every other package depends on it;
 * it depends on nothing. That acyclic root is what keeps the engines
 * independently testable and independently publishable.
 */

export * from "./primitives";
export * from "./animation";
export * from "./mask";
export * from "./color";
export * from "./effects";
export * from "./objects";
export * from "./timeline";
export * from "./media";
export * from "./caption";
export * from "./project";

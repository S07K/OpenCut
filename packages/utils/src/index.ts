/**
 * `@cutaway/utils` — dependency-light helpers shared across every layer.
 *
 * Anything here must be safe to import from an engine, a worker, or a React
 * component. That rules out DOM-only helpers, which belong in `media-engine`.
 */

export { createId } from "./id";
export * from "./factories";
export * from "./aspect";

/**
 * `@cutaway/timeline-engine` — pure timeline logic.
 *
 * No React, no DOM, no canvas. Everything here runs in Node, which is why the
 * export pipeline can reuse it verbatim and why its tests run in milliseconds.
 */

export * from "./time";
export * from "./range";
export * from "./operations";
export * from "./snapping";

/**
 * `@opencut/export-engine` — the headless, backend-agnostic export pipeline.
 *
 * Pure and DOM-free. It plans which frames to render, drives the render→encode
 * loop, reports progress, and handles cancellation — all through two generic
 * interfaces so the browser backends (Pixi frame source, WebCodecs + muxer
 * writer) plug in without the engine knowing they exist. Crucially it renders
 * from the *same* `resolveScene` the preview uses, so the exported file matches
 * the preview frame for frame rather than merely resembling it.
 */

export * from "./plan";
export * from "./progress";
export * from "./providers";
export * from "./codec";
export * from "./run";

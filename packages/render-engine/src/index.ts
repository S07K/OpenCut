/**
 * `@cutaway/render-engine` — resolving a project into a drawable scene.
 *
 * Pure and DOM-free. It decides *what* to draw at a given frame; backends
 * decide *how*. The realtime preview and the headless exporter share this one
 * resolver, which is what makes exported output structurally identical to the
 * preview rather than merely similar.
 */

export * from "./scene";
export * from "./audio";
export * from "./decodeSchedule";

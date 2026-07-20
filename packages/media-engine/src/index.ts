/**
 * `@opencut/media-engine` — the adapters layer for media.
 *
 * Unlike the pure engines, this package *does* touch browser APIs: IndexedDB,
 * `<video>`, canvas, and Web Audio. Each of those sits behind an interface or a
 * pure core so the logic stays testable and so a desktop build can swap the
 * implementations without anything above noticing.
 */

export * from "./mime";
export * from "./storage";
export * from "./probe";
export * from "./waveform";
export * from "./import";
export * from "./clip";
export * from "./gc";

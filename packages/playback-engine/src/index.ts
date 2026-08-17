/**
 * `@cutaway/playback-engine` — transport math.
 *
 * Pure and clock-agnostic. The caller supplies "now", which in the app comes
 * from `AudioContext.currentTime` (see the architecture note on the audio clock
 * being master) and in tests is a plain number.
 */

export * from "./transport";

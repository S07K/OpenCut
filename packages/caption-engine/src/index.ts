/**
 * `@cutaway/caption-engine` — caption block operations and style presets.
 *
 * Pure and DOM-free. Captions are word-level data; this package builds and
 * edits the on-screen blocks and resolves which word is active at a frame, so
 * the renderer can highlight it. Transcription (Whisper) lives behind a
 * provider interface in the app, not here — this package only shapes the
 * resulting words.
 */

export * from "./blocks";
export * from "./presets";

/**
 * Media references.
 *
 * The document never embeds media bytes. It stores a reference, and the
 * `media-engine` resolves that reference to actual bytes from IndexedDB, a
 * File System Access handle, or a URL. This keeps project files small enough to
 * paste into a GitHub issue, and keeps the document format independent of how
 * any given browser chose to persist blobs.
 */

import type { Id, Size } from "./primitives.js";

export type MediaKind = "video" | "audio" | "image" | "gif" | "font";

/** Where the bytes actually live. */
export type MediaSource =
  | { type: "indexeddb"; key: string }
  /** A `FileSystemFileHandle` id; may require re-granting permission. */
  | { type: "filesystem"; handleId: string; path: string }
  | { type: "url"; url: string }
  /** Bundled with the app (stock assets, default fonts). */
  | { type: "builtin"; path: string };

export interface MediaMetadata {
  durationSeconds: number;
  /** Native frame rate; `null` for still images and audio. */
  frameRate: number | null;
  dimensions: Size | null;
  hasAudio: boolean;
  hasVideo: boolean;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  byteSize: number;
}

export interface MediaAsset {
  id: Id;
  name: string;
  kind: MediaKind;
  mimeType: string;
  source: MediaSource;
  metadata: MediaMetadata;
  /** Data-URL or object-URL key for the library thumbnail. */
  thumbnailKey: string | null;
  /** Precomputed peaks for waveform drawing; generated lazily off-thread. */
  waveformKey: string | null;
  importedAt: number;
}

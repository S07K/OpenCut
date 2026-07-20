/**
 * The project document — the single source of truth for the entire editor.
 *
 * Invariants worth stating up front, because everything downstream relies on
 * them:
 *
 * 1. It is **plain JSON**. No classes, no `Date`, no `Map`, no cyclic refs.
 * 2. It is **normalized**. Entities live in flat id-keyed maps; relationships
 *    are id references. This keeps mutations O(1) and makes structural sharing
 *    cheap, which is what lets undo/redo store snapshots without exploding.
 * 3. It is **versioned**. `schemaVersion` gates migrations, so a project saved
 *    today still opens in two years.
 */

import type { CaptionTrackData } from "./caption";
import type { MediaAsset } from "./media";
import type { Clip } from "./objects";
import type { Frame, Id, Size } from "./primitives";
import type { Marker, Track } from "./timeline";

/** Bumped whenever a breaking change lands; drives the migration chain. */
export const SCHEMA_VERSION = 1;

export type AspectRatioPreset = "16:9" | "9:16" | "1:1" | "4:5" | "21:9" | "custom";

export interface ProjectSettings {
  /** Output canvas size in pixels. Aspect ratio is derived from this. */
  resolution: Size;
  aspectRatio: AspectRatioPreset;
  frameRate: number;
  /** Background shown wherever no clip covers the frame. */
  backgroundColor: string;
  sampleRate: number;
}

export type ExportFormat = "mp4" | "mov" | "webm" | "gif" | "avi" | "mp3" | "wav";

export interface ExportSettings {
  format: ExportFormat;
  resolution: Size;
  frameRate: number;
  /** Video bitrate in bits per second. */
  videoBitrate: number;
  audioBitrate: number;
  videoCodec: "h264" | "h265" | "vp9" | "av1" | "none";
  audioCodec: "aac" | "opus" | "mp3" | "none";
  /** Export only this range; `null` exports the full timeline. */
  range: { start: Frame; end: Frame } | null;
}

/**
 * Normalized entity tables. Flat maps rather than nested trees — see invariant
 * (2) above.
 */
export interface ProjectEntities {
  clips: Record<Id, Clip>;
  tracks: Record<Id, Track>;
  media: Record<Id, MediaAsset>;
  markers: Record<Id, Marker>;
  captionTracks: Record<Id, CaptionTrackData>;
}

export interface ProjectDocument {
  schemaVersion: number;
  id: Id;
  name: string;
  createdAt: number;
  modifiedAt: number;

  settings: ProjectSettings;
  entities: ProjectEntities;

  /** Track render order, bottom-first. Mirrors `Track.index` as the authority. */
  trackOrder: Id[];

  /** Total timeline length. Derived on edit, stored so load is O(1). */
  durationFrames: Frame;

  exportSettings: ExportSettings;

  /**
   * Ids of plugins this project depends on. Used to warn on open rather than to
   * block it — a project must always load, even degraded.
   */
  requiredPlugins: string[];
}

/**
 * Timeline structure.
 *
 * Tracks are an ordered list, index 0 rendering *bottom*-most. Clips live in a
 * flat map on the project rather than nested inside tracks, so that moving a
 * clip between tracks is a single field write instead of a splice on two
 * arrays — which matters because that operation happens on every drag frame.
 */

import type { EffectInstance } from "./effects.js";
import type { Frame, Id, Unit } from "./primitives.js";

export type TrackKind = "video" | "audio" | "caption" | "overlay";

export interface Track {
  id: Id;
  name: string;
  kind: TrackKind;
  /** Render order; lower indices composite first (further back). */
  index: number;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  /** Solo overrides mute on all other tracks of the same kind. */
  solo: boolean;
  height: number;
  volume: Unit;
  effects: EffectInstance[];
}

/** A named point on the timeline, used for navigation and chapters. */
export interface Marker {
  id: Id;
  frame: Frame;
  label: string;
  color: string;
  /** Non-zero length turns a marker into a region. */
  durationFrames: number;
}

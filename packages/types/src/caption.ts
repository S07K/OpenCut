/**
 * Caption model.
 *
 * Captions are stored as structured word-level data, *not* as pre-rendered text
 * clips. The renderer derives visual caption clips from this at draw time. That
 * separation is what makes per-word highlighting, restyling with a preset, and
 * re-timing after an edit all possible without destroying the transcript.
 */

import type { Frame, Id, Unit } from "./primitives.js";

export interface CaptionWord {
  text: string;
  startFrame: Frame;
  endFrame: Frame;
  /** Transcription confidence 0..1; drives the "review this" UI affordance. */
  confidence: Unit;
}

/** A caption block is one on-screen unit — typically one to three words. */
export interface CaptionBlock {
  id: Id;
  words: CaptionWord[];
  startFrame: Frame;
  endFrame: Frame;
  /** Per-block style override; falls back to the track's preset. */
  styleOverrideId: string | null;
}

export interface CaptionTrackData {
  id: Id;
  /** Which clip or media this transcript was generated from. */
  sourceMediaId: Id | null;
  language: string;
  blocks: CaptionBlock[];
  /** Registry key of the active preset, e.g. `core.captions.hormozi`. */
  presetId: string;
}

/**
 * A caption preset is plain data (ships as JSON), so the community can add
 * styles by dropping a file in — no code, no rebuild.
 */
export interface CaptionPreset {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  uppercase: boolean;
  color: string;
  activeWordColor: string;
  stroke: { enabled: boolean; color: string; width: number };
  shadow: { enabled: boolean; color: string; offsetY: number; blur: number };
  background: { enabled: boolean; color: string; padding: number; cornerRadius: number };
  /** Words shown on screen at once. */
  wordsPerBlock: number;
  /** Registry key of the per-block entrance animation. */
  animationId: string;
  /** Vertical placement as a fraction of frame height. */
  positionY: Unit;
}

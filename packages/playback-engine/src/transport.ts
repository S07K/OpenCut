/**
 * Transport math.
 *
 * The playhead is **derived**, never accumulated. Each tick computes the frame
 * from `(now - startedAt)` against a clock, rather than adding a delta to the
 * previous position. Accumulating deltas drifts — every rounding error is kept
 * forever — and after a few minutes the video and audio are visibly apart.
 * Deriving from an origin means error is bounded by one tick, permanently.
 *
 * Pure and clock-agnostic: the caller supplies "now". In the app that comes
 * from `AudioContext.currentTime`, but tests supply plain numbers.
 */

import type { Frame } from "@opencut/types";

export interface TransportOrigin {
  /** Frame the playhead sat at when playback started. */
  startFrame: Frame;
  /** Clock reading, in seconds, at that moment. */
  startedAtSeconds: number;
  /** Playback rate multiplier; 1 is realtime, 2 is double speed. */
  rate: number;
}

export interface TransportBounds {
  /** Total timeline length in frames. */
  durationFrames: number;
  loop: boolean;
  /** Optional in/out range to play instead of the whole timeline. */
  inFrame?: number;
  outFrame?: number;
}

export interface TransportTick {
  frame: Frame;
  /** True when playback ran past the end and should stop. */
  ended: boolean;
}

/** Effective play range, honouring in/out points when set. */
export function resolveRange(bounds: TransportBounds): { start: number; end: number } {
  const start = Math.max(0, bounds.inFrame ?? 0);
  const rawEnd = bounds.outFrame ?? bounds.durationFrames;
  // Guarantees a range of at least one frame, so a degenerate range cannot
  // divide by zero in the loop wrap below.
  return { start, end: Math.max(start + 1, rawEnd) };
}

/**
 * Computes the playhead position for a clock reading.
 *
 * Returns a *fractional* frame. Rounding is the caller's decision: the renderer
 * wants an integer, but audio scheduling needs sub-frame precision, and
 * rounding here would throw that away irrecoverably.
 */
export function frameAt(origin: TransportOrigin, nowSeconds: number, frameRate: number): number {
  const elapsed = Math.max(0, nowSeconds - origin.startedAtSeconds);
  return origin.startFrame + elapsed * frameRate * origin.rate;
}

/**
 * Applies range bounds to a raw position.
 *
 * Looping wraps with a modulo rather than resetting to the start, so a slow
 * tick that overshoots the end by several frames resumes at the correct offset
 * instead of snapping and losing time.
 */
export function applyBounds(rawFrame: number, bounds: TransportBounds): TransportTick {
  const { start, end } = resolveRange(bounds);

  if (rawFrame < start) return { frame: start, ended: false };
  if (rawFrame < end) return { frame: rawFrame, ended: false };

  if (!bounds.loop) return { frame: end, ended: true };

  const span = end - start;
  return { frame: start + ((rawFrame - start) % span), ended: false };
}

/** Full tick: clock reading in, bounded playhead out. */
export function tick(
  origin: TransportOrigin,
  nowSeconds: number,
  frameRate: number,
  bounds: TransportBounds,
): TransportTick {
  return applyBounds(frameAt(origin, nowSeconds, frameRate), bounds);
}

/**
 * Builds the origin for a new play run.
 *
 * Starting at or past the end rewinds to the range start — pressing play on a
 * finished timeline should replay it, not sit still.
 */
export function startPlayback(
  currentFrame: Frame,
  nowSeconds: number,
  bounds: TransportBounds,
  rate = 1,
): TransportOrigin {
  const { start, end } = resolveRange(bounds);
  const from = currentFrame >= end - 1 || currentFrame < start ? start : currentFrame;

  return { startFrame: from, startedAtSeconds: nowSeconds, rate };
}

/**
 * Where in a media source to begin, for a clip already underway.
 *
 * Returns `null` when the clip has not started or has already finished — the
 * caller should not schedule it at all.
 */
export function sourceOffsetSeconds(
  clipStartFrame: number,
  clipDurationFrames: number,
  sourceInFrame: number,
  speed: number,
  playheadFrame: number,
  frameRate: number,
): number | null {
  if (playheadFrame >= clipStartFrame + clipDurationFrames) return null;

  const framesIntoClip = Math.max(0, playheadFrame - clipStartFrame);
  return (sourceInFrame + framesIntoClip * speed) / frameRate;
}

/**
 * Seconds of wall time until a clip begins.
 *
 * Zero when it is already playing. Used to schedule audio ahead of time on the
 * audio clock, which is what keeps a source starting exactly on its frame
 * rather than whenever a timer happened to fire.
 */
export function secondsUntilClip(
  clipStartFrame: number,
  playheadFrame: number,
  frameRate: number,
  rate: number,
): number {
  if (clipStartFrame <= playheadFrame) return 0;
  return (clipStartFrame - playheadFrame) / (frameRate * rate);
}

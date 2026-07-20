/**
 * Primitive value types shared across every engine.
 *
 * These are deliberately structural (plain objects, no classes) so that the
 * entire project document round-trips through `JSON.stringify` without loss.
 */

/** Stable identifier for any addressable entity in a project. */
export type Id = string;

/**
 * A point in time, in **frames**, relative to the start of the timeline.
 *
 * We store time as integer frames rather than seconds because floating-point
 * seconds accumulate error under repeated trim/split operations, which shows up
 * as one-frame gaps between clips. Seconds are derived on demand via the
 * project frame rate: `seconds = frame / fps`.
 */
export type Frame = number;

/** A duration measured in frames. */
export type FrameDuration = number;

/** Normalized 0..1 value (opacity, progress, mix amounts). */
export type Unit = number;

/** Degrees, not radians — the UI speaks degrees, so the document does too. */
export type Degrees = number;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Vec2, Size {}

/** Straight (non-premultiplied) RGBA, components 0..255 except alpha 0..1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Inclusive-start, exclusive-end frame range. `[start, end)` */
export interface FrameRange {
  start: Frame;
  end: Frame;
}

export const FRAME_RANGE_EMPTY: FrameRange = { start: 0, end: 0 };

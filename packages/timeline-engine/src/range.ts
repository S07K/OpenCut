/**
 * Frame-range algebra.
 *
 * Ranges are half-open: `[start, end)`. This convention is chosen deliberately —
 * with half-open ranges, "clip A ends where clip B begins" means `a.end === b.start`
 * with no off-by-one, and adjacency, overlap, and duration all have clean
 * definitions. Closed ranges make every one of those a special case.
 */

import type { Clip, Frame, FrameRange } from "@cutaway/types";

export function rangeOf(clip: Clip): FrameRange {
  return { start: clip.startFrame, end: clip.startFrame + clip.durationFrames };
}

export function rangeDuration(range: FrameRange): number {
  return Math.max(0, range.end - range.start);
}

export function isEmptyRange(range: FrameRange): boolean {
  return rangeDuration(range) === 0;
}

export function containsFrame(range: FrameRange, frame: Frame): boolean {
  return frame >= range.start && frame < range.end;
}

/** True when the ranges share at least one frame. Touching is not overlapping. */
export function overlaps(a: FrameRange, b: FrameRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function intersect(a: FrameRange, b: FrameRange): FrameRange | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}

/** Smallest range containing both inputs. */
export function union(a: FrameRange, b: FrameRange): FrameRange {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

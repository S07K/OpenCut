/**
 * Core timeline editing operations.
 *
 * Every function here is **pure**: it takes clips and returns new clips, never
 * mutating its input and never touching global state. That is what lets the
 * history engine treat an edit as a value, and what lets these operations be
 * tested in Node in microseconds without a browser.
 *
 * Operations return `null` (or an unchanged array) when the edit is a no-op,
 * so callers can skip pushing a meaningless undo entry.
 */

import type { Clip, Frame, FrameDuration, Id } from "@opencut/types";
import { rangeOf } from "./range";

/** Minimum clip length. Zero-length clips are unselectable and unrenderable. */
export const MIN_CLIP_FRAMES = 1;

/**
 * Advances a clip's source in-point, for content kinds that read from media.
 *
 * Trimming the head of a video must also skip forward in the source, otherwise
 * the clip would re-show frames the user just trimmed away. Content kinds
 * without a source (text, shapes) are returned untouched.
 */
function advanceSource(clip: Clip, byFrames: number): Clip["content"] {
  const { content } = clip;
  if (content.kind === "video" || content.kind === "audio") {
    return {
      ...content,
      sourceInFrame: content.sourceInFrame + Math.round(byFrames * content.speed),
    };
  }
  return content;
}

/**
 * Splits a clip at an absolute timeline frame.
 *
 * Returns `null` if the frame falls on or outside the clip's boundaries — there
 * is nothing to split there, and producing a zero-length half would be worse
 * than refusing.
 */
export function splitClip(clip: Clip, atFrame: Frame, newId: Id): [Clip, Clip] | null {
  const { start, end } = rangeOf(clip);
  if (atFrame <= start || atFrame >= end) return null;

  const leftDuration = atFrame - start;
  const rightDuration = end - atFrame;
  if (leftDuration < MIN_CLIP_FRAMES || rightDuration < MIN_CLIP_FRAMES) return null;

  const left: Clip = { ...clip, durationFrames: leftDuration };
  const right: Clip = {
    ...clip,
    id: newId,
    startFrame: atFrame,
    durationFrames: rightDuration,
    content: advanceSource(clip, leftDuration),
    // Masks and effects are shared by value on both halves; ids stay unique
    // because the clip id is what scopes them.
  };

  return [left, right];
}

/**
 * Trims the head of a clip to a new absolute start frame.
 *
 * The clip's *end* stays fixed — this is a trim, not a move. The source
 * in-point advances by the same amount so the visible content does not shift.
 */
export function trimClipStart(clip: Clip, newStartFrame: Frame): Clip | null {
  const { start, end } = rangeOf(clip);
  const clamped = Math.min(Math.max(newStartFrame, 0), end - MIN_CLIP_FRAMES);
  const delta = clamped - start;
  if (delta === 0) return null;

  return {
    ...clip,
    startFrame: clamped,
    durationFrames: clip.durationFrames - delta,
    content: advanceSource(clip, delta),
  };
}

/** Trims the tail of a clip to a new absolute end frame. Start stays fixed. */
export function trimClipEnd(clip: Clip, newEndFrame: Frame): Clip | null {
  const { start, end } = rangeOf(clip);
  const clamped = Math.max(newEndFrame, start + MIN_CLIP_FRAMES);
  if (clamped === end) return null;

  return { ...clip, durationFrames: clamped - start };
}

/** Moves a clip to a new start frame, optionally onto a different track. */
export function moveClip(clip: Clip, newStartFrame: Frame, newTrackId?: Id): Clip {
  return {
    ...clip,
    startFrame: Math.max(0, newStartFrame),
    trackId: newTrackId ?? clip.trackId,
  };
}

/**
 * Deletes a clip and pulls every later clip on the same track back by the
 * deleted clip's duration, closing the gap.
 *
 * `trackClips` must contain only clips from one track. Order is irrelevant —
 * the result is sorted by start frame, which callers can rely on.
 */
export function rippleDelete(trackClips: readonly Clip[], clipId: Id): Clip[] {
  const target = trackClips.find((c) => c.id === clipId);
  if (!target) return [...trackClips];

  const gap = target.durationFrames;
  return trackClips
    .filter((c) => c.id !== clipId)
    .map((c) => (c.startFrame >= target.startFrame ? { ...c, startFrame: c.startFrame - gap } : c))
    .sort((a, b) => a.startFrame - b.startFrame);
}

/**
 * Inserts a gap of `durationFrames` at `atFrame`, pushing later clips right.
 *
 * A clip straddling the insertion point is *not* split here; splitting is a
 * separate, explicitly-invoked operation. Straddling clips move whole, which
 * matches how editors expect "insert gap" to behave on locked-together content.
 */
export function rippleInsert(
  trackClips: readonly Clip[],
  atFrame: Frame,
  durationFrames: FrameDuration,
): Clip[] {
  if (durationFrames <= 0) return [...trackClips];

  return trackClips
    .map((c) => (c.startFrame >= atFrame ? { ...c, startFrame: c.startFrame + durationFrames } : c))
    .sort((a, b) => a.startFrame - b.startFrame);
}

/** Total timeline length: the furthest end frame across all clips. */
export function computeDuration(clips: readonly Clip[]): FrameDuration {
  let max = 0;
  for (const clip of clips) {
    const end = clip.startFrame + clip.durationFrames;
    if (end > max) max = end;
  }
  return max;
}

/** Clips overlapping `[start, end)` on the given track, sorted by start frame. */
export function clipsInRange(
  clips: readonly Clip[],
  trackId: Id,
  start: Frame,
  end: Frame,
): Clip[] {
  return clips
    .filter(
      (c) => c.trackId === trackId && c.startFrame < end && c.startFrame + c.durationFrames > start,
    )
    .sort((a, b) => a.startFrame - b.startFrame);
}

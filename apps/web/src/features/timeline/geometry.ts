import type { CaptionBlock, CaptionTrackData, Clip, Frame, Id, Track } from "@opencut/types";

/**
 * Timeline coordinate math.
 *
 * Pure functions, no canvas and no React — which means the hit-testing that
 * decides what a click selects is unit-testable without mounting anything.
 * Hit-test bugs are otherwise miserable to reproduce.
 */

export const RULER_HEIGHT = 28;
/** Vertical gap between lanes, so adjacent clips read as separate rows. */
export const TRACK_GAP = 2;
/** Width of the trim handle at each end of a clip, in pixels. */
export const TRIM_HANDLE_WIDTH = 6;
/** Height of a caption lane, sitting below the clip tracks. */
export const CAPTION_LANE_HEIGHT = 34;

export interface TimelineViewport {
  /** Leftmost visible frame. */
  scrollFrame: number;
  pixelsPerFrame: number;
  /** Width of the canvas area, in CSS pixels. */
  width: number;
  height: number;
}

export function frameToX(frame: Frame, viewport: TimelineViewport): number {
  return (frame - viewport.scrollFrame) * viewport.pixelsPerFrame;
}

export function xToFrame(x: number, viewport: TimelineViewport): Frame {
  return viewport.scrollFrame + x / viewport.pixelsPerFrame;
}

/** Vertical extent of a track lane, measured from the top of the canvas. */
export interface TrackLayout {
  track: Track;
  top: number;
  height: number;
}

export function layoutTracks(tracks: readonly Track[]): TrackLayout[] {
  const layouts: TrackLayout[] = [];
  let cursor = RULER_HEIGHT;

  for (const track of tracks) {
    layouts.push({ track, top: cursor, height: track.height });
    cursor += track.height + TRACK_GAP;
  }

  return layouts;
}

export function totalTracksHeight(tracks: readonly Track[]): number {
  return tracks.reduce((sum, track) => sum + track.height + TRACK_GAP, RULER_HEIGHT);
}

/** A caption track laid out as a lane below the clip tracks. */
export interface CaptionLaneLayout {
  track: CaptionTrackData;
  top: number;
  height: number;
}

/** Lays out caption tracks as lanes stacked below the clip tracks (from `startY`). */
export function layoutCaptionTracks(
  captionTracks: readonly CaptionTrackData[],
  startY: number,
): CaptionLaneLayout[] {
  const lanes: CaptionLaneLayout[] = [];
  let cursor = startY;

  for (const track of captionTracks) {
    lanes.push({ track, top: cursor, height: CAPTION_LANE_HEIGHT });
    cursor += CAPTION_LANE_HEIGHT + TRACK_GAP;
  }

  return lanes;
}

/** A caption block's on-screen rectangle within its lane. */
export interface CaptionBlockRect {
  trackId: Id;
  block: CaptionBlock;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every visible caption block across all lanes, in draw order. */
export function visibleCaptionBlocks(
  lanes: readonly CaptionLaneLayout[],
  viewport: TimelineViewport,
): CaptionBlockRect[] {
  const rects: CaptionBlockRect[] = [];

  for (const lane of lanes) {
    for (const block of lane.track.blocks) {
      const x = frameToX(block.startFrame, viewport);
      const width = (block.endFrame - block.startFrame) * viewport.pixelsPerFrame;
      if (x + width < 0 || x > viewport.width) continue; // cull off-screen
      rects.push({ trackId: lane.track.id, block, x, y: lane.top, width, height: lane.height });
    }
  }

  return rects;
}

export interface CaptionBlockHit {
  rect: CaptionBlockRect;
  zone: ClipHitZone;
}

/**
 * The caption block under a point, topmost first, with which zone was hit — the
 * body (move) or an end handle (trim), mirroring how clips are grabbed.
 */
export function hitTestCaptionBlock(
  x: number,
  y: number,
  rects: readonly CaptionBlockRect[],
): CaptionBlockHit | null {
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index];
    if (!rect) continue;
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue;

    const canTrim = rect.width > TRIM_HANDLE_WIDTH * 3;
    if (canTrim && x <= rect.x + TRIM_HANDLE_WIDTH) return { rect, zone: "trim-start" };
    if (canTrim && x >= rect.x + rect.width - TRIM_HANDLE_WIDTH) return { rect, zone: "trim-end" };
    return { rect, zone: "body" };
  }
  return null;
}

export interface ClipRect {
  clip: Clip;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clipRect(
  clip: Clip,
  layouts: readonly TrackLayout[],
  viewport: TimelineViewport,
): ClipRect | null {
  const layout = layouts.find((candidate) => candidate.track.id === clip.trackId);
  if (!layout) return null;

  return {
    clip,
    x: frameToX(clip.startFrame, viewport),
    y: layout.top,
    width: clip.durationFrames * viewport.pixelsPerFrame,
    height: layout.height,
  };
}

/** Clips intersecting the viewport, in draw order. This is the virtualization. */
export function visibleClips(
  clips: readonly Clip[],
  layouts: readonly TrackLayout[],
  viewport: TimelineViewport,
): ClipRect[] {
  const rects: ClipRect[] = [];

  for (const clip of clips) {
    const rect = clipRect(clip, layouts, viewport);
    if (!rect) continue;
    // Cull off-screen clips before they ever reach the draw loop; this is what
    // keeps a 500-clip timeline at 60fps.
    if (rect.x + rect.width < 0 || rect.x > viewport.width) continue;
    rects.push(rect);
  }

  return rects;
}

export type ClipHitZone = "body" | "trim-start" | "trim-end";

export interface ClipHit {
  clipId: Id;
  zone: ClipHitZone;
}

/**
 * Finds the clip under a point.
 *
 * Iterates in reverse so the topmost clip wins, matching what the user sees.
 */
export function hitTestClip(x: number, y: number, rects: readonly ClipRect[]): ClipHit | null {
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index];
    if (!rect) continue;

    const inside =
      x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    if (!inside) continue;

    // Trim handles are suppressed on clips too narrow to show them, otherwise a
    // short clip becomes impossible to grab by its body.
    const canTrim = rect.width > TRIM_HANDLE_WIDTH * 3;
    if (canTrim && x <= rect.x + TRIM_HANDLE_WIDTH) {
      return { clipId: rect.clip.id, zone: "trim-start" };
    }
    if (canTrim && x >= rect.x + rect.width - TRIM_HANDLE_WIDTH) {
      return { clipId: rect.clip.id, zone: "trim-end" };
    }
    return { clipId: rect.clip.id, zone: "body" };
  }

  return null;
}

/** The track lane at a given y, or null when over the ruler or empty space. */
export function trackAtY(y: number, layouts: readonly TrackLayout[]): Track | null {
  for (const layout of layouts) {
    if (y >= layout.top && y <= layout.top + layout.height) return layout.track;
  }
  return null;
}

/**
 * Chooses a ruler tick interval that keeps labels readable at any zoom.
 *
 * Steps are musical/temporal rather than powers of ten — a tick every 8 seconds
 * is useless to a video editor, one every 5 or 10 is not.
 */
export function chooseTickInterval(pixelsPerFrame: number, fps: number): number {
  const candidatesInSeconds = [1 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const minimumSpacingPx = 72;

  for (const seconds of candidatesInSeconds) {
    const frames = Math.max(1, Math.round(seconds * fps));
    if (frames * pixelsPerFrame >= minimumSpacingPx) return frames;
  }

  return Math.round(600 * fps);
}

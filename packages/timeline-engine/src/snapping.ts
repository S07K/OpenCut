/**
 * Snapping.
 *
 * Snapping is computed in *pixel* space, not frame space. If the threshold were
 * a fixed number of frames, snapping would feel sticky when zoomed out and
 * useless when zoomed in. Expressing it in pixels keeps the feel identical at
 * every zoom level, which is the whole point of the feature.
 */

import type { Clip, Frame, Id, Marker } from "@cutaway/types";

export type SnapKind = "clip-start" | "clip-end" | "playhead" | "marker" | "timeline-start";

export interface SnapTarget {
  frame: Frame;
  kind: SnapKind;
  /** Id of the clip or marker that produced this target, when applicable. */
  sourceId: Id | null;
}

export interface SnapResult {
  frame: Frame;
  target: SnapTarget | null;
}

export interface SnapContext {
  clips: readonly Clip[];
  markers: readonly Marker[];
  playhead: Frame;
  /** Clips to exclude — normally the ones being dragged. */
  excludeClipIds: ReadonlySet<Id>;
  /** Timeline horizontal scale. */
  pixelsPerFrame: number;
  /** Snap radius in screen pixels. */
  thresholdPx: number;
}

/** Default snap radius; tuned to feel assistive without fighting the user. */
export const DEFAULT_SNAP_THRESHOLD_PX = 8;

export function collectSnapTargets(context: SnapContext): SnapTarget[] {
  const targets: SnapTarget[] = [
    { frame: 0, kind: "timeline-start", sourceId: null },
    { frame: context.playhead, kind: "playhead", sourceId: null },
  ];

  for (const clip of context.clips) {
    if (context.excludeClipIds.has(clip.id)) continue;
    targets.push({ frame: clip.startFrame, kind: "clip-start", sourceId: clip.id });
    targets.push({
      frame: clip.startFrame + clip.durationFrames,
      kind: "clip-end",
      sourceId: clip.id,
    });
  }

  for (const marker of context.markers) {
    targets.push({ frame: marker.frame, kind: "marker", sourceId: marker.id });
  }

  return targets;
}

/**
 * Snaps `frame` to the nearest target within the pixel threshold.
 *
 * Ties are broken by target order, which puts the playhead and timeline start
 * ahead of clip edges — the anchors users most expect to win.
 */
export function snapFrame(frame: Frame, context: SnapContext): SnapResult {
  const thresholdFrames = context.thresholdPx / Math.max(context.pixelsPerFrame, 1e-6);

  let best: SnapTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of collectSnapTargets(context)) {
    const distance = Math.abs(target.frame - frame);
    if (distance <= thresholdFrames && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }

  return best ? { frame: best.frame, target: best } : { frame, target: null };
}

/**
 * Snaps a dragged clip by testing both of its edges and applying whichever
 * snaps more strongly.
 *
 * Testing both edges is what makes butt-joining clips feel effortless: the user
 * can drag by the middle of a clip and still have its tail land exactly on the
 * next clip's head.
 */
export function snapClipDrag(
  proposedStart: Frame,
  durationFrames: number,
  context: SnapContext,
): SnapResult {
  const startResult = snapFrame(proposedStart, context);
  const endResult = snapFrame(proposedStart + durationFrames, context);

  const startDelta = startResult.target ? Math.abs(startResult.frame - proposedStart) : Infinity;
  const endDelta = endResult.target
    ? Math.abs(endResult.frame - (proposedStart + durationFrames))
    : Infinity;

  if (startDelta === Infinity && endDelta === Infinity) {
    return { frame: proposedStart, target: null };
  }

  return startDelta <= endDelta
    ? startResult
    : { frame: endResult.frame - durationFrames, target: endResult.target };
}

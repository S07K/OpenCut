/**
 * Resolving the project's audio into a flat, mixable timeline.
 *
 * The realtime preview plays audio a frame at a time; export needs the whole
 * thing laid out at once to render offline. This module turns audio-track clips
 * into placements — where each starts in the output, where it reads from its
 * source, how long, how loud — using the *same* audibility rules as
 * `resolveScene` (solo overrides mute, per-track gain), so the exported mix
 * matches what the editor plays. Pure and DOM-free; the OfflineAudioContext
 * mixing lives in the adapter.
 *
 * Scope note: like `resolveScene`, only clips on audio tracks contribute. A
 * video clip's embedded audio is silent in preview today, so it is silent here
 * too — closing that gap belongs in the resolver, where it fixes both at once.
 */

import type { Frame, ProjectDocument } from "@opencut/types";
import { evaluate } from "@opencut/animation-engine";

/** One audio clip placed on the output timeline, ready to schedule for mixing. */
export interface ResolvedAudioClip {
  clipId: string;
  mediaId: string;
  /** Start time in the *output* (seconds from the export's first frame, ≥ 0). */
  startSeconds: number;
  /** Offset into the source media to begin reading, in seconds. */
  sourceInSeconds: number;
  /** Output duration in seconds (already clipped to the export range). */
  durationSeconds: number;
  /** Playback rate; 2 = double speed. */
  speed: number;
  /** Linear gain — clip volume × track volume, evaluated at the clip's start. */
  gain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

/**
 * Resolves all audible audio clips overlapping `[startFrame, endFrame)` into
 * output-relative placements. Frames outside the range are clipped, and a clip
 * that starts before the range has its source in-point advanced accordingly, so
 * exporting a sub-range stays sample-accurate.
 */
export function resolveAudioTimeline(
  project: ProjectDocument,
  startFrame: Frame,
  endFrame: Frame,
): ResolvedAudioClip[] {
  const { entities, settings } = project;
  const fps = settings.frameRate;

  const hasSoloedAudio = Object.values(entities.tracks).some(
    (track) => track.kind === "audio" && track.solo,
  );

  const resolved: ResolvedAudioClip[] = [];

  for (const clip of Object.values(entities.clips)) {
    if (clip.content.kind !== "audio") continue;
    if (clip.hidden || clip.content.muted) continue;

    const track = entities.tracks[clip.trackId];
    if (!track || track.kind !== "audio") continue;

    const audible = hasSoloedAudio ? track.solo : !track.muted;
    if (!audible) continue;

    const clipStart = clip.startFrame;
    const clipEnd = clip.startFrame + clip.durationFrames;

    // Intersect the clip with the export range.
    const from = Math.max(clipStart, startFrame);
    const to = Math.min(clipEnd, endFrame);
    if (to <= from) continue;

    // Frames of the clip skipped because the export starts mid-clip; the source
    // must advance by that much (scaled by speed, as it consumes source faster).
    const headFrames = from - clipStart;
    const sourceInSeconds = (clip.content.sourceInFrame + headFrames * clip.content.speed) / fps;

    resolved.push({
      clipId: clip.id,
      mediaId: clip.content.mediaId,
      startSeconds: (from - startFrame) / fps,
      sourceInSeconds,
      durationSeconds: (to - from) / fps,
      speed: clip.content.speed,
      gain: evaluate(clip.content.volume, from) * track.volume,
      fadeInSeconds: clip.content.fadeInFrames / fps,
      fadeOutSeconds: clip.content.fadeOutFrames / fps,
    });
  }

  // Deterministic order (by start, then id) so a mix is reproducible.
  resolved.sort((a, b) => a.startSeconds - b.startSeconds || a.clipId.localeCompare(b.clipId));
  return resolved;
}

/**
 * Resolving the project's audio into a flat, mixable timeline.
 *
 * The realtime preview plays audio a frame at a time; export needs the whole
 * thing laid out at once to render offline. This module turns every audible clip
 * — audio-track clips *and* video clips that carry an audio stream — into
 * placements: where each starts in the output, where it reads from its source,
 * how long, how loud. It is the single source of truth for audibility, consumed
 * by both the export mixer and the preview's scheduler, so what you hear while
 * editing is exactly what lands in the file. Pure and DOM-free; the actual Web
 * Audio mixing lives in the adapters.
 */

import type { Animatable, Clip, Frame, ProjectDocument, Unit } from "@opencut/types";
import { evaluate } from "@opencut/animation-engine";

/** The audio-bearing fields shared by audio clips and video clips. */
interface ClipAudio {
  mediaId: string;
  sourceInFrame: number;
  speed: number;
  volume: Animatable<Unit>;
  muted: boolean;
  fadeInFrames: number;
  fadeOutFrames: number;
}

/** The audio source of a clip, or null for clips that carry no audio. */
function clipAudioOf(clip: Clip): ClipAudio | null {
  if (clip.content.kind === "audio") {
    const c = clip.content;
    return {
      mediaId: c.mediaId,
      sourceInFrame: c.sourceInFrame,
      speed: c.speed,
      volume: c.volume,
      muted: c.muted,
      fadeInFrames: c.fadeInFrames,
      fadeOutFrames: c.fadeOutFrames,
    };
  }
  if (clip.content.kind === "video") {
    const c = clip.content;
    // A video clip's embedded audio has no fade controls of its own yet.
    return {
      mediaId: c.mediaId,
      sourceInFrame: c.sourceInFrame,
      speed: c.speed,
      volume: c.volume,
      muted: c.muted,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    };
  }
  return null;
}

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
    const audio = clipAudioOf(clip);
    if (!audio) continue;
    if (clip.hidden || audio.muted) continue;

    const track = entities.tracks[clip.trackId];
    if (!track) continue;

    if (clip.content.kind === "audio") {
      // Audio tracks honour solo/mute among themselves.
      if (hasSoloedAudio ? !track.solo : track.muted) continue;
    } else {
      // A video clip lends its embedded audio only when the media actually has
      // an audio stream, its track is not muted, and no audio track is soloed
      // (a solo means "isolate that audio").
      if (hasSoloedAudio || track.muted) continue;
      if (!entities.media[audio.mediaId]?.metadata.hasAudio) continue;
    }

    const clipStart = clip.startFrame;
    const clipEnd = clip.startFrame + clip.durationFrames;

    // Intersect the clip with the export range.
    const from = Math.max(clipStart, startFrame);
    const to = Math.min(clipEnd, endFrame);
    if (to <= from) continue;

    // Frames of the clip skipped because the export starts mid-clip; the source
    // must advance by that much (scaled by speed, as it consumes source faster).
    const headFrames = from - clipStart;
    const sourceInSeconds = (audio.sourceInFrame + headFrames * audio.speed) / fps;

    resolved.push({
      clipId: clip.id,
      mediaId: audio.mediaId,
      startSeconds: (from - startFrame) / fps,
      sourceInSeconds,
      durationSeconds: (to - from) / fps,
      speed: audio.speed,
      gain: evaluate(audio.volume, from) * track.volume,
      fadeInSeconds: audio.fadeInFrames / fps,
      fadeOutSeconds: audio.fadeOutFrames / fps,
    });
  }

  // Deterministic order (by start, then id) so a mix is reproducible.
  resolved.sort((a, b) => a.startSeconds - b.startSeconds || a.clipId.localeCompare(b.clipId));
  return resolved;
}

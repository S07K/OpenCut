"use client";

import type { ExportPlan } from "@opencut/export-engine";
import { resolveAudioTimeline, type ResolvedAudioClip } from "@opencut/render-engine";
import type { MediaBlobStore } from "@opencut/media-engine";
import type { ProjectDocument } from "@opencut/types";

/**
 * Mixes the project's audio clips into a single buffer for the export range.
 *
 * The pure engine decides *what* plays where ({@link resolveAudioTimeline}); this
 * renders it offline. Each clip is decoded, gain-staged (with fades), placed at
 * its output time, and summed by an OfflineAudioContext — the browser's own
 * mixer, which also resamples every source to the output rate for free. Returns
 * null when there is nothing audible, so the caller exports video-only.
 */
export async function mixProjectAudio(
  project: ProjectDocument,
  store: MediaBlobStore,
  plan: ExportPlan,
): Promise<AudioBuffer | null> {
  if (typeof globalThis.OfflineAudioContext === "undefined") return null;

  const clips = resolveAudioTimeline(project, plan.startFrame, plan.endFrame);
  if (clips.length === 0) return null;

  const sampleRate = clampSampleRate(project.settings.sampleRate);
  const length = Math.ceil(plan.durationSeconds * sampleRate);
  if (length <= 0) return null;

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });

  let scheduled = 0;
  await Promise.all(
    clips.map(async (clip) => {
      const asset = project.entities.media[clip.mediaId];
      if (!asset || asset.source.type !== "indexeddb") return;

      const blob = await store.get(asset.source.key);
      if (!blob) return;

      let buffer: AudioBuffer;
      try {
        // decodeAudioData resamples to ctx.sampleRate, so mixed output is uniform.
        buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      } catch {
        return; // A file that won't decode is skipped, not fatal to the export.
      }

      scheduleClip(ctx, buffer, clip);
      scheduled += 1;
    }),
  );

  if (scheduled === 0) return null;
  return ctx.startRendering();
}

/** Wires one clip into the offline graph: source → gain (with fades) → output. */
function scheduleClip(
  ctx: OfflineAudioContext,
  buffer: AudioBuffer,
  clip: ResolvedAudioClip,
): void {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = clip.speed;

  const gain = ctx.createGain();
  const start = clip.startSeconds;
  const end = start + clip.durationSeconds;
  const level = clip.gain;

  // Gain automation runs in output time. Fades ramp from/to zero; without a
  // fade the level is set flat at the clip's start.
  if (clip.fadeInSeconds > 0) {
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(
      level,
      start + Math.min(clip.fadeInSeconds, clip.durationSeconds),
    );
  } else {
    gain.gain.setValueAtTime(level, start);
  }
  if (clip.fadeOutSeconds > 0) {
    const fadeStart = Math.max(start, end - clip.fadeOutSeconds);
    gain.gain.setValueAtTime(level, fadeStart);
    gain.gain.linearRampToValueAtTime(0, end);
  }

  source.connect(gain).connect(ctx.destination);

  // start(when, offset, duration): offset/duration are in *source* seconds, so
  // the consumed span scales with playbackRate to yield `durationSeconds` of
  // output.
  source.start(start, clip.sourceInSeconds, clip.durationSeconds * clip.speed);
}

/** Keeps the sample rate within the range OfflineAudioContext accepts. */
function clampSampleRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 48_000;
  return Math.min(96_000, Math.max(8_000, Math.round(rate)));
}

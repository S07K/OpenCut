"use client";

import type { Id, ProjectDocument } from "@cutaway/types";
import type { MediaBlobStore } from "@cutaway/media-engine";
import { resolveAudioTimeline, type ResolvedAudioClip } from "@cutaway/render-engine";

/**
 * Web Audio playback and the master clock.
 *
 * `AudioContext.currentTime` is the timebase for the whole editor. It is a
 * monotonic, hardware-backed clock that does not stall when the main thread is
 * busy — unlike `requestAnimationFrame`, which drops frames under load and
 * would let the playhead fall behind the sound. Audio leads; video chases.
 *
 * Sources are scheduled *ahead* on that clock rather than started by a timer,
 * so a clip begins on exactly its frame instead of whenever a callback fired.
 */

interface ScheduledSource {
  clipId: Id;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<Id, AudioBuffer>();
  private readonly decoding = new Map<Id, Promise<AudioBuffer | null>>();
  private scheduled: ScheduledSource[] = [];

  constructor(private readonly store: MediaBlobStore) {}

  /**
   * Returns the audio context, creating it on first use.
   *
   * Created lazily because browsers block audio contexts until a user gesture;
   * building one at page load yields a permanently suspended context.
   */
  private ensureContext(): AudioContext {
    this.context ??= new AudioContext();
    return this.context;
  }

  /** Current reading of the master clock, in seconds. */
  now(): number {
    return this.ensureContext().currentTime;
  }

  /** Browsers start contexts suspended until a gesture; playback must resume it. */
  async resume(): Promise<void> {
    const context = this.ensureContext();
    if (context.state === "suspended") await context.resume();
  }

  async decodeFor(mediaId: Id, blobKey: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(mediaId);
    if (cached) return cached;

    const inFlight = this.decoding.get(mediaId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const blob = await this.store.get(blobKey);
        if (!blob) return null;

        const buffer = await this.ensureContext().decodeAudioData(await blob.arrayBuffer());
        this.buffers.set(mediaId, buffer);
        return buffer;
      } catch {
        // Silent video, or a codec this browser cannot decode. Not an error
        // worth interrupting playback for.
        return null;
      } finally {
        this.decoding.delete(mediaId);
      }
    })();

    this.decoding.set(mediaId, promise);
    return promise;
  }

  /**
   * Pre-decodes every audio source in the project.
   *
   * Done before playback starts rather than on demand: decoding is slow enough
   * that hitting it mid-playback would drop the clip entirely, and a clip that
   * silently fails to sound is worse than a brief wait before play begins.
   */
  async prepare(project: ProjectDocument): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    for (const clip of Object.values(project.entities.clips)) {
      if (clip.content.kind !== "audio" && clip.content.kind !== "video") continue;

      const asset = project.entities.media[clip.content.mediaId];
      if (!asset || asset.source.type !== "indexeddb") continue;
      if (!asset.metadata.hasAudio) continue;

      tasks.push(this.decodeFor(asset.id, asset.source.key));
    }

    await Promise.allSettled(tasks);
  }

  /**
   * Schedules every audible clip from `fromFrame` onward.
   *
   * Called once when playback starts, not per frame. Web Audio scheduling is
   * fire-and-forget by design: sources placed on the clock now will sound at
   * exactly the right moment even if the main thread stalls afterwards.
   *
   * Clip selection, placement, gain, and fades all come from the shared
   * `resolveAudioTimeline` — the same resolver the exporter mixes from — so
   * preview and export agree on what is audible (including a video clip's own
   * audio). This engine only maps those placements onto the clock: the resolver
   * works in output seconds, and `rate` compresses that into real time (2× play
   * means a clip one output-second away starts in half a second).
   */
  scheduleFrom(project: ProjectDocument, fromFrame: number, rate: number): void {
    const context = this.ensureContext();
    const startedAt = context.currentTime;

    for (const clip of resolveAudioTimeline(project, fromFrame, project.durationFrames)) {
      const buffer = this.buffers.get(clip.mediaId);
      if (!buffer || clip.durationSeconds <= 0) continue;

      const when = startedAt + clip.startSeconds / rate;
      const realDuration = clip.durationSeconds / rate;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clip.speed * rate;

      const gain = context.createGain();
      applyGainEnvelope(gain, clip, when, realDuration, rate);

      source.connect(gain).connect(context.destination);
      // start(when, offset, duration): offset/duration are in source seconds, so
      // the consumed span scales with speed (playbackRate already folds in rate).
      source.start(when, clip.sourceInSeconds, clip.durationSeconds * clip.speed);

      this.scheduled.push({ clipId: clip.clipId, source, gain });
    }
  }

  /** Stops and releases every scheduled source. */
  stopAll(): void {
    for (const entry of this.scheduled) {
      try {
        entry.source.stop();
      } catch {
        // Already ended; stopping twice throws and is harmless.
      }
      entry.source.disconnect();
      entry.gain.disconnect();
    }
    this.scheduled = [];
  }

  destroy(): void {
    this.stopAll();
    this.buffers.clear();
    void this.context?.close();
    this.context = null;
  }
}

/**
 * Applies a clip's level and fades to its gain node, on the real (rate-scaled)
 * clock. Fades ramp from/to zero; a clip with no fade holds a flat level. This
 * mirrors the export mixer's envelope so preview and export sound the same.
 */
function applyGainEnvelope(
  gain: GainNode,
  clip: ResolvedAudioClip,
  when: number,
  realDuration: number,
  rate: number,
): void {
  const level = clip.gain;
  const fadeIn = Math.min(clip.fadeInSeconds, clip.durationSeconds) / rate;
  const fadeOut = clip.fadeOutSeconds / rate;

  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + fadeIn);
  } else {
    gain.gain.setValueAtTime(level, when);
  }

  if (fadeOut > 0) {
    const fadeStart = when + Math.max(0, realDuration - fadeOut);
    gain.gain.setValueAtTime(level, fadeStart);
    gain.gain.linearRampToValueAtTime(0, when + realDuration);
  }
}

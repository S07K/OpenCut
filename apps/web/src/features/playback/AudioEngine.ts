"use client";

import type { Id, ProjectDocument } from "@opencut/types";
import type { MediaBlobStore } from "@opencut/media-engine";
import { secondsUntilClip, sourceOffsetSeconds } from "@opencut/playback-engine";

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
   */
  scheduleFrom(project: ProjectDocument, fromFrame: number, rate: number): void {
    const context = this.ensureContext();
    const frameRate = project.settings.frameRate;
    const startedAt = context.currentTime;

    const hasSolo = Object.values(project.entities.tracks).some(
      (track) => track.kind === "audio" && track.solo,
    );

    for (const clip of Object.values(project.entities.clips)) {
      if (clip.content.kind !== "audio") continue;
      if (clip.hidden || clip.content.muted) continue;

      const track = project.entities.tracks[clip.trackId];
      if (!track) continue;
      if (hasSolo ? !track.solo : track.muted) continue;

      const buffer = this.buffers.get(clip.content.mediaId);
      if (!buffer) continue;

      const offset = sourceOffsetSeconds(
        clip.startFrame,
        clip.durationFrames,
        clip.content.sourceInFrame,
        clip.content.speed,
        fromFrame,
        frameRate,
      );
      if (offset === null) continue;

      const delay = secondsUntilClip(clip.startFrame, fromFrame, frameRate, rate);

      // Remaining clip length, so a trimmed clip stops at its out point rather
      // than playing the rest of the source file.
      const framesRemaining = clip.durationFrames - Math.max(0, fromFrame - clip.startFrame);
      const durationSeconds = (framesRemaining / frameRate) * clip.content.speed;
      if (durationSeconds <= 0) continue;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clip.content.speed * rate;

      const gain = context.createGain();
      // Clip volume is not animated here yet; the static value is read at
      // schedule time. Animated volume needs param automation, which lands with
      // the audio effects work.
      const clipVolume = clip.content.volume.type === "static" ? clip.content.volume.value : 1;
      gain.gain.value = clipVolume * track.volume;

      source.connect(gain).connect(context.destination);
      source.start(startedAt + delay, offset, durationSeconds);

      this.scheduled.push({ clipId: clip.id, source, gain });
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

"use client";

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { MediaBlobStore } from "@cutaway/media-engine";
import type { VideoDecodeSchedule } from "@cutaway/render-engine";
import type { Id, ProjectDocument } from "@cutaway/types";

/**
 * Frame-exact video decoding for export.
 *
 * Seeking a `<video>` element is the wrong tool for an exporter twice over: the
 * frame you get back is whatever the element settled on (and if the seek is slow
 * you may capture the *previous* one), and every seek re-decodes from the
 * nearest keyframe, so an export pays that cost once per frame.
 *
 * This decodes with WebCodecs instead, driven from a schedule computed up front.
 * Handed all the timestamps in order, the decoder walks each stream once and
 * decodes each packet at most once — so frames are both exactly right and far
 * cheaper than seeking. Feeding the schedule lazily is not an option: the
 * decoding pipeline only emits a frame once it knows the *next* timestamp, so a
 * one-at-a-time feed would deadlock. Hence the planning pass.
 *
 * Because the schedule and the render loop are both derived from `resolveScene`
 * over the same frames, the two stay in lockstep — one decoded frame per
 * request. {@link ExactVideoDecoders.next} still verifies that, and falls back
 * to a direct (slower) fetch if they ever disagree, so a drift becomes a slow
 * frame rather than a wrong one.
 */
export class ExactVideoDecoders {
  private constructor(private readonly tracks: Map<Id, DecoderTrack>) {}

  /**
   * Opens a decoder for every video in `schedule`.
   *
   * A media that can't be demuxed (an exotic container, a corrupt file) is
   * simply absent from the result: the caller then falls back to element
   * seeking for it, so one awkward file degrades quality instead of failing
   * the whole export.
   */
  static async create(
    project: ProjectDocument,
    store: MediaBlobStore,
    schedule: VideoDecodeSchedule,
  ): Promise<ExactVideoDecoders> {
    const tracks = new Map<Id, DecoderTrack>();

    await Promise.all(
      [...schedule].map(async ([mediaId, timestamps]) => {
        const asset = project.entities.media[mediaId];
        if (!asset || asset.source.type !== "indexeddb") return;

        const blob = await store.get(asset.source.key);
        if (!blob) return;

        const track = await DecoderTrack.open(blob, timestamps);
        if (track) tracks.set(mediaId, track);
      }),
    );

    return new ExactVideoDecoders(tracks);
  }

  /** True when this media is being decoded exactly (rather than seeked). */
  has(mediaId: Id): boolean {
    return this.tracks.has(mediaId);
  }

  /**
   * The next decoded frame for `mediaId`, which must be the one scheduled for
   * `expectedSeconds`. Returns null when the media isn't decoded here or the
   * stream has no frame at that time (before the first frame, or past the end).
   */
  next(mediaId: Id, expectedSeconds: number): Promise<CanvasImageSource | null> {
    const track = this.tracks.get(mediaId);
    return track ? track.next(expectedSeconds) : Promise.resolve(null);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.tracks.values()].map((track) => track.dispose()));
    this.tracks.clear();
  }
}

/** One video stream, plus the cursor into its planned timestamps. */
class DecoderTrack {
  private cursor = 0;

  private constructor(
    private readonly input: Input,
    private readonly sink: CanvasSink,
    private readonly timestamps: readonly number[],
    private iterator: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null> | null,
  ) {}

  static async open(blob: Blob, timestamps: number[]): Promise<DecoderTrack | null> {
    try {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        await input.dispose();
        return null;
      }

      // A small pool keeps VRAM flat across a long export instead of allocating
      // a canvas per frame; `alpha` preserves transparent video for compositing.
      const sink = new CanvasSink(track, { poolSize: 2, alpha: true });
      const iterator = sink.canvasesAtTimestamps(timestamps);

      return new DecoderTrack(input, sink, timestamps, iterator);
    } catch {
      // Unreadable or unsupported — the caller falls back to element seeking.
      return null;
    }
  }

  async next(expectedSeconds: number): Promise<CanvasImageSource | null> {
    const scheduled = this.timestamps[this.cursor];

    // Out of step with the plan (or past its end): fetch this one directly
    // rather than handing back a frame from the wrong moment. Correctness first;
    // this path is not expected to run.
    if (scheduled === undefined || Math.abs(scheduled - expectedSeconds) > 1e-6) {
      return this.fetchDirectly(expectedSeconds);
    }

    this.cursor += 1;
    const result = await this.iterator?.next();
    if (!result || result.done) return null;
    return result.value?.canvas ?? null;
  }

  /** Random access for the off-schedule case; re-decodes from a keyframe. */
  private async fetchDirectly(seconds: number): Promise<CanvasImageSource | null> {
    const wrapped = await this.sink.getCanvas(seconds);
    return wrapped?.canvas ?? null;
  }

  async dispose(): Promise<void> {
    await this.iterator?.return(undefined);
    this.iterator = null;
    await this.input.dispose();
  }
}

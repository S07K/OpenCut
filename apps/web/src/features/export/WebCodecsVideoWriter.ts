"use client";

import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import type { ExportPlan, VideoWriter } from "@opencut/export-engine";
import { resolveVideoConfig } from "./capabilities";

/**
 * A VideoWriter backed by WebCodecs + an in-memory MP4/WebM muxer.
 *
 * It binds the engine's opaque `TFrame` to the real `VideoFrame` and turns a
 * stream of composited frames into container bytes. The engine drives *when*
 * each frame is written and at what timestamp; this class owns *how* — encoder
 * configuration, keyframe cadence, backpressure, and muxing.
 *
 * Two correctness details worth stating:
 * - Timestamps come from the engine, not the source frame. Each frame is
 *   re-wrapped with the engine's explicit PTS/duration before encoding, so the
 *   encoded chunk's own timestamp is exact and the muxer needs no override. The
 *   encoder runs in `realtime` latency mode, which disables B-frames, so decode
 *   order equals presentation order and no composition-time bookkeeping is
 *   needed.
 * - Backpressure is honoured. Encoding is async; without waiting on the queue a
 *   long export would buffer every frame in memory at once.
 */

type Container =
  { kind: "mp4"; muxer: Mp4Muxer<Mp4Target> } | { kind: "webm"; muxer: WebmMuxer<WebmTarget> };

export class WebCodecsVideoWriter implements VideoWriter<VideoFrame> {
  private readonly encoder: VideoEncoder;
  private readonly container: Container;
  private framesEncoded = 0;
  private readonly keyFrameInterval: number;
  /** The first fatal encoder error, surfaced on the next call. */
  private failure: Error | null = null;
  private finalized = false;

  private constructor(encoder: VideoEncoder, container: Container, keyFrameInterval: number) {
    this.encoder = encoder;
    this.container = container;
    this.keyFrameInterval = keyFrameInterval;
  }

  /** Probes support, configures the encoder, and wires it to the muxer. */
  static async create(plan: ExportPlan): Promise<WebCodecsVideoWriter> {
    const resolved = await resolveVideoConfig(plan);
    const { width, height } = plan.resolution;

    // A keyframe every ~2 seconds: enough seek granularity without inflating
    // the file the way all-keyframe output would.
    const keyFrameInterval = Math.max(1, Math.round(plan.frameRate * 2));

    let container: Container;
    let addChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;

    if (plan.format === "webm") {
      const muxer = new WebmMuxer({
        target: new WebmTarget(),
        video: { codec: resolved.muxerCodec, width, height, frameRate: plan.frameRate },
        firstTimestampBehavior: "offset",
      });
      container = { kind: "webm", muxer };
      addChunk = (chunk, meta) => muxer.addVideoChunk(chunk, meta);
    } else {
      const muxer = new Mp4Muxer({
        target: new Mp4Target(),
        video: {
          codec: resolved.muxerCodec as "avc" | "hevc" | "vp9" | "av1",
          width,
          height,
          frameRate: plan.frameRate,
        },
        fastStart: "in-memory",
        firstTimestampBehavior: "offset",
      });
      container = { kind: "mp4", muxer };
      addChunk = (chunk, meta) => muxer.addVideoChunk(chunk, meta);
    }

    const writer = new WebCodecsVideoWriter(
      new VideoEncoder({
        // The chunk's own timestamp is the engine PTS (each frame is re-stamped
        // before encoding), so the muxer needs no timestamp override.
        output: (chunk, meta) => {
          try {
            addChunk(chunk, meta);
          } catch (error) {
            writer.failure ??= asError(error);
          }
        },
        error: (error) => {
          writer.failure ??= asError(error);
        },
      }),
      container,
      keyFrameInterval,
    );

    // realtime mode disables B-frames, keeping decode order == presentation order.
    writer.encoder.configure({ ...resolved.encoderConfig, latencyMode: "realtime" });
    return writer;
  }

  async addFrame(
    frame: VideoFrame,
    timestampMicros: number,
    durationMicros: number,
  ): Promise<void> {
    if (this.failure) throw this.failure;

    // Backpressure: let the encoder drain before piling on more work, so peak
    // memory stays bounded on long exports.
    while (this.encoder.encodeQueueSize > 8) {
      await waitForDequeue(this.encoder);
      if (this.failure) throw this.failure;
    }

    const keyFrame = this.framesEncoded % this.keyFrameInterval === 0;
    // A fresh VideoFrame carrying the engine's timestamp/duration makes the
    // encoded chunk's own timing exact, so the muxer needs no PTS override.
    const stamped = new VideoFrame(frame, {
      timestamp: timestampMicros,
      duration: durationMicros,
    });
    try {
      this.encoder.encode(stamped, { keyFrame });
    } finally {
      stamped.close();
    }
    this.framesEncoded += 1;
  }

  async finalize(): Promise<Uint8Array> {
    if (this.failure) throw this.failure;
    await this.encoder.flush();
    if (this.failure) throw this.failure;

    this.finalized = true;
    if (this.container.kind === "mp4") {
      this.container.muxer.finalize();
      return new Uint8Array(this.container.muxer.target.buffer);
    }
    this.container.muxer.finalize();
    return new Uint8Array(this.container.muxer.target.buffer);
  }

  dispose(): void {
    // finalize() already closes the encoder via flush(); only close here when we
    // are tearing down early (error or cancel) to avoid a double close.
    if (!this.finalized && this.encoder.state !== "closed") {
      this.encoder.close();
    }
  }
}

/** Resolves when the encoder signals it has drained a chunk, or after a tick. */
function waitForDequeue(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      encoder.removeEventListener("dequeue", done);
      resolve();
    };
    encoder.addEventListener("dequeue", done, { once: true });
    // Fallback in case the browser does not emit 'dequeue' promptly.
    setTimeout(done, 8);
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

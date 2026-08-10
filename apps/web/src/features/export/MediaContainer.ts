"use client";

import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import type { ExportPlan } from "@opencut/export-engine";
import type { ResolvedAudioConfig, ResolvedVideoConfig } from "./capabilities";

/**
 * Owns the muxer and both media tracks for one export.
 *
 * Video and audio are encoded by separate WebCodecs encoders but must land in
 * the *same* file, so the muxer can't belong to either encoder — it lives here,
 * declared with both tracks up front (the container format requires that). The
 * video writer and the audio encoder each push their chunks in; whoever runs
 * last calls `finalize`. Order between tracks doesn't matter: with in-memory
 * fast-start the muxer interleaves samples by timestamp at finalize.
 */
type Backing =
  { kind: "mp4"; muxer: Mp4Muxer<Mp4Target> } | { kind: "webm"; muxer: WebmMuxer<WebmTarget> };

export class MediaContainer {
  private constructor(private readonly backing: Backing) {}

  static create(
    plan: ExportPlan,
    video: ResolvedVideoConfig,
    audio: ResolvedAudioConfig | null,
  ): MediaContainer {
    const { width, height } = plan.resolution;

    if (plan.format === "webm") {
      const muxer = new WebmMuxer({
        target: new WebmTarget(),
        video: { codec: video.muxerCodec, width, height, frameRate: plan.frameRate },
        audio: audio
          ? {
              codec: audio.muxerCodec,
              numberOfChannels: audio.encoderConfig.numberOfChannels,
              sampleRate: audio.encoderConfig.sampleRate,
            }
          : undefined,
        firstTimestampBehavior: "offset",
      });
      return new MediaContainer({ kind: "webm", muxer });
    }

    const muxer = new Mp4Muxer({
      target: new Mp4Target(),
      video: {
        codec: video.muxerCodec as "avc" | "hevc" | "vp9" | "av1",
        width,
        height,
        frameRate: plan.frameRate,
      },
      audio: audio
        ? {
            codec: audio.muxerCodec as "aac" | "opus",
            numberOfChannels: audio.encoderConfig.numberOfChannels,
            sampleRate: audio.encoderConfig.sampleRate,
          }
        : undefined,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    return new MediaContainer({ kind: "mp4", muxer });
  }

  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    this.backing.muxer.addVideoChunk(chunk, meta);
  }

  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
    this.backing.muxer.addAudioChunk(chunk, meta);
  }

  /** Finishes the file and returns its bytes. Call once, after all chunks. */
  finalize(): Uint8Array {
    this.backing.muxer.finalize();
    return new Uint8Array(this.backing.muxer.target.buffer);
  }
}

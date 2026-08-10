"use client";

import type { MediaContainer } from "./MediaContainer";
import type { ResolvedAudioConfig } from "./capabilities";

/** Samples per AudioData chunk fed to the encoder — a balance of overhead vs latency. */
const CHUNK_FRAMES = 4_096;

/**
 * Encodes a mixed AudioBuffer into the container's audio track.
 *
 * The buffer is sliced into fixed-size AudioData chunks (planar float32) with
 * index-derived timestamps, so audio timing can't drift over a long export —
 * the same discipline the video side uses. Encoder errors surface synchronously
 * on the next chunk or after flush.
 */
export async function encodeAudioBuffer(
  buffer: AudioBuffer,
  config: ResolvedAudioConfig,
  container: MediaContainer,
): Promise<void> {
  if (typeof globalThis.AudioEncoder === "undefined") return;

  let failure: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      try {
        container.addAudioChunk(chunk, meta);
      } catch (error) {
        failure ??= asError(error);
      }
    },
    error: (error) => {
      failure ??= asError(error);
    },
  });
  encoder.configure(config.encoderConfig);

  const { numberOfChannels, sampleRate, length } = buffer;

  for (let offset = 0; offset < length; offset += CHUNK_FRAMES) {
    if (failure) break;

    const frames = Math.min(CHUNK_FRAMES, length - offset);
    // Planar layout: all of channel 0, then all of channel 1, …
    const planar = new Float32Array(frames * numberOfChannels);
    for (let channel = 0; channel < numberOfChannels; channel++) {
      buffer.copyFromChannel(
        planar.subarray(channel * frames, (channel + 1) * frames),
        channel,
        offset,
      );
    }

    const data = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: planar,
    });
    try {
      encoder.encode(data);
    } finally {
      data.close();
    }

    // Yield periodically so a large mix doesn't block the main thread outright.
    if (offset % (CHUNK_FRAMES * 32) === 0) await Promise.resolve();
  }

  if (!failure) await encoder.flush();
  if (encoder.state !== "closed") encoder.close();
  if (failure) throw failure;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

"use client";

import type { CaptionWord } from "@cutaway/types";
import { wordsFromTimestamps, type TimestampedWord } from "@cutaway/caption-engine";
import type {
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
} from "./transcription";

/** Whisper is trained on 16 kHz mono audio; the decode step resamples to this. */
const SAMPLE_RATE = 16_000;

/**
 * Default model. The `_timestamped` export bundles the cross-attention heads
 * Whisper needs to place words in time — the plain export can only timestamp
 * whole phrases, so word-level highlighting requires this variant. Small enough
 * to download once, accurate enough for captions the user reviews.
 */
const DEFAULT_MODEL = "onnx-community/whisper-base_timestamped";

/** The download is the first half of the bar, inference the second. */
const DOWNLOAD_SHARE = 0.5;

type WorkerOutbound =
  | { type: "download"; id: number; fraction: number }
  | { type: "inference"; id: number; fraction: number }
  | {
      type: "result";
      id: number;
      chunks: { text: string; timestamp: [number | null, number | null] }[];
    }
  | { type: "error"; id: number; message: string };

/**
 * On-device speech recognition, real this time.
 *
 * Implements the same {@link TranscriptionProvider} the stub did, so wiring it
 * in is a one-line swap — nothing above the interface changes. The heavy lifting
 * (model load + inference) happens in a Web Worker; this class is the main-thread
 * half: it decodes the media to the PCM Whisper wants, drives the worker, folds
 * the two work phases into one progress bar, and maps the model's second-based
 * word timestamps to caption words through the pure engine helper.
 *
 * Local-first end to end: the model streams from the Hugging Face CDN on first
 * use and is then cached by the browser, with no account and no server of ours
 * in the loop. WebGPU is used when present and WASM otherwise, so it never needs
 * a GPU — the worker decides.
 */
export class WhisperTranscriptionProvider implements TranscriptionProvider {
  readonly id = "core.transcription.whisper";
  readonly name = "Whisper (on-device)";

  private worker: Worker | null = null;
  private nextRequestId = 1;

  constructor(private readonly modelId: string = DEFAULT_MODEL) {}

  isAvailable(): boolean {
    // Needs a Worker to host the model and WebAudio to decode the source. Both
    // are present in every browser we target; the guard keeps SSR/Node safe.
    return (
      typeof window !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof (
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext
      ) !== "undefined"
    );
  }

  private getWorker(): Worker {
    this.worker ??= new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    return this.worker;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const audio = await decodeToMonoPcm(request.media);

    const chunks = await this.runWorker(audio, request);

    const timestamped: TimestampedWord[] = chunks.map((chunk) => ({
      text: chunk.text,
      start: chunk.timestamp[0],
      end: chunk.timestamp[1],
    }));
    const words: CaptionWord[] = wordsFromTimestamps(timestamped, request.frameRate);

    return { words, language: request.language };
  }

  /** Sends one job to the worker and resolves with its word chunks. */
  private runWorker(
    audio: Float32Array,
    request: TranscriptionRequest,
  ): Promise<{ text: string; timestamp: [number | null, number | null] }[]> {
    const worker = this.getWorker();
    const id = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerOutbound>) => {
        const message = event.data;
        if (message.id !== id) return;

        switch (message.type) {
          case "download":
            request.onProgress?.(message.fraction * DOWNLOAD_SHARE);
            break;
          case "inference":
            request.onProgress?.(DOWNLOAD_SHARE + message.fraction * (1 - DOWNLOAD_SHARE));
            break;
          case "result":
            cleanup();
            resolve(message.chunks);
            break;
          case "error":
            cleanup();
            reject(new Error(message.message));
            break;
        }
      };

      const onAbort = () => {
        cleanup();
        // Tear the worker down so an aborted (possibly mid-download) job doesn't
        // keep running; the next request rebuilds it.
        this.worker?.terminate();
        this.worker = null;
        reject(new DOMException("Transcription cancelled", "AbortError"));
      };

      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        request.signal?.removeEventListener("abort", onAbort);
      };

      worker.addEventListener("message", onMessage);
      request.signal?.addEventListener("abort", onAbort, { once: true });

      // The audio buffer is transferred (not copied) so a long clip doesn't
      // duplicate megabytes across the worker boundary.
      worker.postMessage(
        { type: "transcribe", id, modelId: this.modelId, audio, language: request.language },
        [audio.buffer],
      );
    });
  }
}

/**
 * Decodes any media blob to a single 16 kHz mono Float32 PCM track.
 *
 * Whisper takes exactly this shape, so we do the resample-and-downmix here with
 * an `OfflineAudioContext` rather than pushing raw container bytes at the model.
 * A video file's audio track decodes the same way as an audio file's.
 */
async function decodeToMonoPcm(media: Blob): Promise<Float32Array> {
  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const arrayBuffer = await media.arrayBuffer();

  // Decode at the source rate first (decodeAudioData won't resample), then
  // render through an offline context fixed at Whisper's rate to downsample.
  const decodeCtx = new AudioCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void decodeCtx.close();
  }

  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  // One channel, already at 16 kHz — copy out so the buffer is transferable.
  return rendered.getChannelData(0).slice();
}

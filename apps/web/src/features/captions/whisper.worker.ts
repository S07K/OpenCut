/// <reference lib="webworker" />

/**
 * Whisper speech recognition, off the main thread.
 *
 * Model loading and inference are heavy enough to freeze the UI for seconds to
 * minutes, so they run here in a dedicated worker. The main thread sends decoded
 * 16 kHz mono PCM and gets back word-level timestamps; nothing about the model
 * or ONNX runtime leaks across the boundary.
 *
 * The pipeline is built lazily on the first request and then reused, so the
 * (large, one-time) model download happens once per session and every later
 * transcription is fast. We prefer WebGPU when the runtime offers it and fall
 * back to WASM, so it runs everywhere without ever requiring a GPU.
 */

import {
  env,
  pipeline,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressCallback,
} from "@huggingface/transformers";

// Models come from the Hugging Face CDN, not a local `/models` path — skip the
// local probe (which would 404 against our own origin before falling back).
env.allowLocalModels = false;

/** Whisper always runs at 16 kHz, so audio length in samples gives its seconds. */
const SAMPLE_RATE = 16_000;

type InboundMessage = {
  type: "transcribe";
  id: number;
  modelId: string;
  audio: Float32Array;
  language: string;
};

type OutboundMessage =
  | { type: "download"; id: number; fraction: number }
  | { type: "inference"; id: number; fraction: number }
  | {
      type: "result";
      id: number;
      chunks: { text: string; timestamp: [number | null, number | null] }[];
    }
  | { type: "error"; id: number; message: string };

const post = (message: OutboundMessage) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message);

/** The loaded pipeline, keyed by model so switching models rebuilds it. */
let loaded: { modelId: string; transcriber: AutomaticSpeechRecognitionPipeline } | null = null;

/** True once we've confirmed a WebGPU adapter exists on this device. */
async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}

async function getTranscriber(
  modelId: string,
  onDownload: ProgressCallback,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (loaded && loaded.modelId === modelId) return loaded.transcriber;

  const webgpu = await hasWebGPU();
  const transcriber = (await pipeline("automatic-speech-recognition", modelId, {
    // q4 on the GPU, q8 on WASM — small enough to download once, accurate enough
    // for captions the user reviews. Falls back cleanly if the device lacks either.
    device: webgpu ? "webgpu" : "wasm",
    dtype: webgpu ? "q4" : "q8",
    progress_callback: onDownload,
  })) as AutomaticSpeechRecognitionPipeline;

  loaded = { modelId, transcriber };
  return transcriber;
}

/**
 * Model download spans many files; collapse their per-file progress into a
 * single 0..1 fraction so the UI shows one smooth bar rather than a flicker of
 * competing percentages.
 */
function downloadAggregator(id: number): ProgressCallback {
  const totals = new Map<string, { loaded: number; total: number }>();
  return (event) => {
    if (event.status !== "progress") return;
    totals.set(event.file, { loaded: event.loaded, total: event.total });
    let loadedBytes = 0;
    let totalBytes = 0;
    for (const entry of totals.values()) {
      loadedBytes += entry.loaded;
      totalBytes += entry.total;
    }
    if (totalBytes > 0) post({ type: "download", id, fraction: loadedBytes / totalBytes });
  };
}

self.onmessage = async (event: MessageEvent<InboundMessage>) => {
  const message = event.data;
  if (message.type !== "transcribe") return;
  const { id, modelId, audio, language } = message;

  try {
    const transcriber = await getTranscriber(modelId, downloadAggregator(id));
    post({ type: "download", id, fraction: 1 });

    // Progress tracks how far through the audio the decoder has reached: each
    // 30s window reports its start offset in seconds, which over the clip's
    // duration is an honest 0..1 bar even for a long recording.
    const durationSeconds = Math.max(1, audio.length / SAMPLE_RATE);
    const streamer = new WhisperTextStreamer(
      // The ASR pipeline's tokenizer is a WhisperTokenizer at runtime; the
      // pipeline type just widens it to the base class.
      transcriber.tokenizer as unknown as ConstructorParameters<typeof WhisperTextStreamer>[0],
      {
        // Without our own text callback the streamer falls back to a Node
        // stdout writer, which is undefined in the browser — a no-op silences it.
        callback_function: () => {},
        on_chunk_start: (offsetSeconds: number) =>
          post({
            type: "inference",
            id,
            fraction: Math.min(0.99, offsetSeconds / durationSeconds),
          }),
      },
    );

    const output = await transcriber(audio, {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      // English-only models reject language/task options, so only pass them
      // when the model is multilingual (its id lacks the `.en` suffix).
      ...(modelId.endsWith(".en") ? {} : { language, task: "transcribe" }),
      streamer,
    });

    const result = Array.isArray(output) ? output[0] : output;
    const rawChunks: { text: string; timestamp: [number, number] }[] = result?.chunks ?? [];
    const chunks = rawChunks.map((chunk) => ({
      text: chunk.text,
      timestamp: chunk.timestamp as [number | null, number | null],
    }));

    post({ type: "inference", id, fraction: 1 });
    post({ type: "result", id, chunks });
  } catch (error) {
    // Log the full error for debugging, but hand the UI only the message.
    console.error("[whisper.worker]", error);
    post({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  }
};

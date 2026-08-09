"use client";

import type { CaptionWord } from "@opencut/types";

/**
 * Transcription behind an interface.
 *
 * The core promise is local-first: transcription must work with no account and
 * no paid API. The real default is Faster-Whisper — as WASM in the browser, or
 * the optional FastAPI service for speed — but that is a heavy model download
 * and a large integration. So transcription is an *interface* with a swappable
 * implementation: a Whisper provider, a cloud provider (as a plugin), or the
 * built-in stub used until Whisper is wired in.
 *
 * Nothing above this file knows which provider is running; the editor calls
 * `transcribe` and receives word-level timings.
 */

export interface TranscriptionRequest {
  /** The audio/video bytes to transcribe. */
  media: Blob;
  language: string;
  frameRate: number;
  /** Reports 0..1 progress so the UI can show a bar during a long decode. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  words: CaptionWord[];
  language: string;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly name: string;
  /** True when the provider can run in the current environment. */
  isAvailable(): boolean;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

/**
 * Placeholder provider used until Whisper is integrated.
 *
 * It does not actually listen to audio — it lays down evenly-timed placeholder
 * words across the clip so the *entire* caption pipeline (blocks, styling,
 * highlighting, editing, rendering) is usable and testable end-to-end now. Its
 * confidence is 0, which the editor surfaces as "review this", making clear the
 * text is a placeholder to be replaced by real transcription or hand-editing.
 *
 * Swapping in real Whisper is implementing one interface — no caller changes.
 */
export class StubTranscriptionProvider implements TranscriptionProvider {
  readonly id = "core.transcription.stub";
  readonly name = "Placeholder (no speech recognition)";

  isAvailable(): boolean {
    return true;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const durationSeconds = await audioDuration(request.media);
    const frameRate = request.frameRate;
    const totalFrames = Math.max(1, Math.round(durationSeconds * frameRate));

    // One placeholder word per ~0.5s, so a block-builder has something to group.
    const wordCount = Math.max(1, Math.round(durationSeconds * 2));
    const framesPerWord = totalFrames / wordCount;

    const words: CaptionWord[] = [];
    for (let i = 0; i < wordCount; i += 1) {
      words.push({
        text: "…",
        startFrame: Math.round(i * framesPerWord),
        endFrame: Math.round((i + 1) * framesPerWord),
        confidence: 0,
      });
      request.onProgress?.((i + 1) / wordCount);
    }

    return { words, language: request.language };
  }
}

/** Reads a media blob's duration without keeping the element around. */
function audioDuration(media: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(media);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;

    const done = (seconds: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : 5);
    };

    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(5); // Undecodable → a sensible default span.
    el.src = url;
  });
}

/**
 * The active provider.
 *
 * A single mutable slot rather than a registry for now; when the plugin SDK
 * lands this becomes a registry keyed by provider id. Kept module-scoped so the
 * whole app shares one instance.
 */
let activeProvider: TranscriptionProvider = new StubTranscriptionProvider();

export function getTranscriptionProvider(): TranscriptionProvider {
  return activeProvider;
}

export function setTranscriptionProvider(provider: TranscriptionProvider): void {
  activeProvider = provider;
}

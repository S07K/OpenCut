/**
 * Turning transcriber word timestamps into caption words.
 *
 * A speech recogniser (Whisper) reports words with start/end times in *seconds*;
 * everything downstream — blocks, highlighting, the timeline — works in frames.
 * This pure step is the boundary between the two, so the provider glue in the
 * app stays a thin worker wrapper and the interesting logic is testable here.
 *
 * Real transcripts are messy: a model may emit a null timestamp for a word it
 * couldn't align, hand back words slightly out of order, or give a start ≥ end.
 * We repair rather than reject — a caption with a jittery edge still reads fine,
 * a dropped word does not — so every input word becomes exactly one output word.
 */

import type { CaptionWord, Frame } from "@cutaway/types";

/** One transcribed word with a `[start, end]` span in seconds (either may be null). */
export interface TimestampedWord {
  text: string;
  /** Seconds from the start of the media; null when the model couldn't align it. */
  start: number | null;
  end: number | null;
  /** 0..1 model confidence, if the provider exposes one. */
  confidence?: number;
}

const secondsToFrame = (seconds: number, frameRate: number): Frame =>
  Math.max(0, Math.round(seconds * frameRate));

/**
 * Maps transcribed words (seconds) to caption words (frames).
 *
 * Missing or non-increasing timestamps are filled from the surrounding words so
 * the result is always a clean, forward-moving sequence of at-least-one-frame
 * spans — the shape `buildBlocks` and per-word highlighting rely on. Empty and
 * whitespace-only tokens are dropped; their text carries no caption.
 */
export function wordsFromTimestamps(
  words: readonly TimestampedWord[],
  frameRate: number,
  defaultConfidence = 0.9,
): CaptionWord[] {
  const cleaned = words.filter((w) => w.text.trim().length > 0);
  const result: CaptionWord[] = [];

  for (let i = 0; i < cleaned.length; i += 1) {
    const word = cleaned[i]!;
    const next = cleaned[i + 1];

    // Start: the model's time, else just after the previous word, else 0.
    const prevEnd = result[result.length - 1]?.endFrame ?? 0;
    const startFrame =
      word.start != null ? Math.max(prevEnd, secondsToFrame(word.start, frameRate)) : prevEnd;

    // End: the model's time, else the next word's start, else a short beat —
    // always at least one frame past the start so the span is never empty.
    const rawEnd =
      word.end != null
        ? secondsToFrame(word.end, frameRate)
        : next?.start != null
          ? secondsToFrame(next.start, frameRate)
          : startFrame + Math.max(1, Math.round(frameRate * 0.3));
    const endFrame = Math.max(startFrame + 1, rawEnd);

    result.push({
      text: word.text.trim(),
      startFrame,
      endFrame,
      confidence: clamp01(word.confidence ?? defaultConfidence),
    });
  }

  return result;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

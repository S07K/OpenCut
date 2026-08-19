import { describe, expect, it } from "vitest";
import { wordsFromTimestamps, type TimestampedWord } from "../timestamps";

const w = (text: string, start: number | null, end: number | null, confidence?: number) =>
  ({ text, start, end, confidence }) as TimestampedWord;

describe("wordsFromTimestamps", () => {
  it("converts seconds to frames at the given frame rate", () => {
    const words = wordsFromTimestamps([w("hello", 0, 0.5), w("world", 0.5, 1)], 30);
    expect(words).toEqual([
      { text: "hello", startFrame: 0, endFrame: 15, confidence: 0.9 },
      { text: "world", startFrame: 15, endFrame: 30, confidence: 0.9 },
    ]);
  });

  it("carries through the model's per-word confidence when present", () => {
    const [word] = wordsFromTimestamps([w("hi", 0, 0.5, 0.42)], 30);
    expect(word!.confidence).toBe(0.42);
  });

  it("fills a null start from the previous word's end", () => {
    const words = wordsFromTimestamps([w("a", 0, 0.5), w("b", null, 1)], 30);
    expect(words[1]!.startFrame).toBe(15);
    expect(words[1]!.endFrame).toBe(30);
  });

  it("fills a null end from the next word's start", () => {
    const words = wordsFromTimestamps([w("a", 0, null), w("b", 0.5, 1)], 30);
    expect(words[0]!.endFrame).toBe(15);
  });

  it("gives a trailing word with no end a short default beat", () => {
    const [word] = wordsFromTimestamps([w("bye", 1, null)], 30);
    // 0.3s beat at 30fps = 9 frames past the start (30).
    expect(word!.endFrame).toBe(39);
  });

  it("never lets a span be empty or run backwards", () => {
    const words = wordsFromTimestamps([w("x", 1, 1), w("y", 0.5, 0.6)], 30);
    expect(words[0]!.endFrame).toBeGreaterThan(words[0]!.startFrame);
    // The out-of-order second word is pulled forward, not placed before the first.
    expect(words[1]!.startFrame).toBeGreaterThanOrEqual(words[0]!.endFrame);
  });

  it("drops empty and whitespace-only tokens", () => {
    const words = wordsFromTimestamps([w("keep", 0, 0.5), w("   ", 0.5, 1)], 30);
    expect(words.map((word) => word.text)).toEqual(["keep"]);
  });

  it("trims surrounding whitespace the tokeniser leaves on words", () => {
    const [word] = wordsFromTimestamps([w(" hello", 0, 0.5)], 30);
    expect(word!.text).toBe("hello");
  });

  it("clamps an out-of-range confidence into 0..1", () => {
    const [word] = wordsFromTimestamps([w("hi", 0, 0.5, 5)], 30);
    expect(word!.confidence).toBe(1);
  });
});

/**
 * Caption block operations.
 *
 * Captions are stored as word-level data; a *block* is the on-screen unit
 * (typically one to three words). These pure functions build blocks from a flat
 * word stream and edit them — split, merge, retime, edit text — without ever
 * losing the underlying word timings, which is what keeps per-word highlighting
 * and re-styling possible after an edit.
 *
 * Pure and DOM-free; every function returns new data and never mutates.
 */

import type { CaptionBlock, CaptionWord, Frame, Id } from "@opencut/types";

/** A block's span is derived from its words, so it can never disagree with them. */
export function blockSpan(words: readonly CaptionWord[]): { startFrame: Frame; endFrame: Frame } {
  if (words.length === 0) return { startFrame: 0, endFrame: 0 };
  return {
    startFrame: Math.min(...words.map((w) => w.startFrame)),
    endFrame: Math.max(...words.map((w) => w.endFrame)),
  };
}

function makeBlock(id: Id, words: CaptionWord[]): CaptionBlock {
  return { id, words, ...blockSpan(words), styleOverrideId: null };
}

/**
 * Groups a word stream into blocks of at most `wordsPerBlock`.
 *
 * A block is also cut early when the silent gap to the next word exceeds
 * `maxGapFrames`, so a natural pause starts a new caption rather than a block
 * spanning a long silence — the timing readers actually expect.
 */
export function buildBlocks(
  words: readonly CaptionWord[],
  wordsPerBlock: number,
  maxGapFrames: number,
  makeId: () => Id,
): CaptionBlock[] {
  const blocks: CaptionBlock[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length > 0) {
      blocks.push(makeBlock(makeId(), current));
      current = [];
    }
  };

  const perBlock = Math.max(1, wordsPerBlock);

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    current.push(word);

    const next = words[i + 1];
    const gapTooBig = next ? next.startFrame - word.endFrame > maxGapFrames : false;

    if (current.length >= perBlock || gapTooBig) flush();
  }

  flush();
  return blocks;
}

/**
 * Splits a block after the `afterIndex`-th word into two.
 *
 * Returns `null` when the split would leave an empty half — a caption with no
 * words is not a caption.
 */
export function splitBlock(
  block: CaptionBlock,
  afterIndex: number,
  makeId: () => Id,
): [CaptionBlock, CaptionBlock] | null {
  if (afterIndex < 0 || afterIndex >= block.words.length - 1) return null;

  const left = block.words.slice(0, afterIndex + 1);
  const right = block.words.slice(afterIndex + 1);
  if (left.length === 0 || right.length === 0) return null;

  // The left half keeps the original id so any style override rides with it.
  return [{ ...block, words: left, ...blockSpan(left) }, makeBlock(makeId(), right)];
}

/**
 * Merges two adjacent blocks into one.
 *
 * Words are concatenated in timeline order rather than argument order, so
 * merging is correct regardless of which block was passed first.
 */
export function mergeBlocks(a: CaptionBlock, b: CaptionBlock): CaptionBlock {
  const [first, second] = a.startFrame <= b.startFrame ? [a, b] : [b, a];
  const words = [...first.words, ...second.words];
  return { ...first, words, ...blockSpan(words) };
}

/** Replaces a word's text, preserving its timing and confidence. */
export function editWord(block: CaptionBlock, wordIndex: number, text: string): CaptionBlock {
  if (wordIndex < 0 || wordIndex >= block.words.length) return block;
  return {
    ...block,
    words: block.words.map((word, i) => (i === wordIndex ? { ...word, text } : word)),
  };
}

/**
 * Shifts an entire block in time by `deltaFrames`, words included.
 *
 * The words move with the block so their relative timing — and therefore
 * per-word highlighting — survives a re-time. Clamped so a block cannot be
 * dragged before frame 0.
 */
export function shiftBlock(block: CaptionBlock, deltaFrames: number): CaptionBlock {
  const clampedDelta = Math.max(deltaFrames, -block.startFrame);
  if (clampedDelta === 0) return block;

  const words = block.words.map((word) => ({
    ...word,
    startFrame: word.startFrame + clampedDelta,
    endFrame: word.endFrame + clampedDelta,
  }));

  return { ...block, words, ...blockSpan(words) };
}

/**
 * Re-times a block to occupy `[startFrame, endFrame)`, scaling every word to fit.
 *
 * Trimming a caption on the timeline should change *when* it shows and for how
 * long without dropping words, so word timings are stretched or compressed
 * linearly into the new window. The window is clamped to at least one frame per
 * word so words never collapse to zero-length (which would break highlighting).
 */
export function retimeBlock(block: CaptionBlock, startFrame: Frame, endFrame: Frame): CaptionBlock {
  const start = Math.max(0, Math.round(startFrame));
  const minSpan = Math.max(1, block.words.length);
  const end = Math.max(start + minSpan, Math.round(endFrame));

  const oldStart = block.startFrame;
  const oldSpan = Math.max(1, block.endFrame - block.startFrame);
  const scale = (end - start) / oldSpan;

  const words = block.words.map((word) => ({
    ...word,
    startFrame: Math.round(start + (word.startFrame - oldStart) * scale),
    endFrame: Math.round(start + (word.endFrame - oldStart) * scale),
  }));

  return { ...block, words, ...blockSpan(words) };
}

/** The block visible at `frame`, or null. Blocks are half-open `[start, end)`. */
export function blockAtFrame(blocks: readonly CaptionBlock[], frame: Frame): CaptionBlock | null {
  for (const block of blocks) {
    if (frame >= block.startFrame && frame < block.endFrame) return block;
  }
  return null;
}

/**
 * Index of the word active at `frame` within a block, or -1.
 *
 * This is what drives karaoke-style highlighting. Between words (in a gap) the
 * *previous* word stays highlighted rather than flickering to none, which reads
 * far better on fast speech.
 */
export function activeWordIndex(block: CaptionBlock, frame: Frame): number {
  let active = -1;
  for (let i = 0; i < block.words.length; i += 1) {
    const word = block.words[i]!;
    if (frame >= word.startFrame) active = i;
    if (frame < word.endFrame) break;
  }
  return active;
}

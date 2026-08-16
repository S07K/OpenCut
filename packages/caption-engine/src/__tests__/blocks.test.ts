import { describe, expect, it } from "vitest";
import type { CaptionBlock, CaptionWord } from "@opencut/types";
import {
  activeWordIndex,
  blockAtFrame,
  blockSpan,
  buildBlocks,
  editWord,
  mergeBlocks,
  retimeBlock,
  shiftBlock,
  splitBlock,
} from "../blocks";
import { CAPTION_PRESETS, DEFAULT_CAPTION_PRESET_ID, getCaptionPreset } from "../presets";

let counter = 0;
const makeId = () => `b${(counter += 1)}`;

function word(text: string, startFrame: number, endFrame: number): CaptionWord {
  return { text, startFrame, endFrame, confidence: 1 };
}

function block(words: CaptionWord[], id = "blk"): CaptionBlock {
  return { id, words, ...blockSpan(words), styleOverrideId: null };
}

describe("blockSpan", () => {
  it("derives the span from the words", () => {
    expect(blockSpan([word("a", 10, 20), word("b", 20, 35)])).toEqual({
      startFrame: 10,
      endFrame: 35,
    });
  });

  it("is empty for no words", () => {
    expect(blockSpan([])).toEqual({ startFrame: 0, endFrame: 0 });
  });
});

describe("buildBlocks", () => {
  const words = [
    word("one", 0, 10),
    word("two", 10, 20),
    word("three", 20, 30),
    word("four", 30, 40),
  ];

  it("groups into blocks of at most wordsPerBlock", () => {
    const blocks = buildBlocks(words, 2, 1000, makeId);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.words.map((w) => w.text)).toEqual(["one", "two"]);
    expect(blocks[1]!.words.map((w) => w.text)).toEqual(["three", "four"]);
  });

  it("cuts a block early on a silence longer than the gap threshold", () => {
    const gapped = [word("hello", 0, 10), word("world", 60, 70)];
    // 50-frame gap exceeds the 20-frame threshold, so two blocks despite
    // wordsPerBlock allowing both.
    const blocks = buildBlocks(gapped, 5, 20, makeId);
    expect(blocks).toHaveLength(2);
  });

  it("derives each block's span from its words", () => {
    const blocks = buildBlocks(words, 2, 1000, makeId);
    expect(blocks[0]!.startFrame).toBe(0);
    expect(blocks[0]!.endFrame).toBe(20);
  });

  it("returns nothing for an empty stream", () => {
    expect(buildBlocks([], 3, 100, makeId)).toEqual([]);
  });

  it("treats wordsPerBlock below 1 as 1", () => {
    expect(buildBlocks(words, 0, 1000, makeId)).toHaveLength(4);
  });
});

describe("splitBlock", () => {
  const source = block([word("a", 0, 10), word("b", 10, 20), word("c", 20, 30)]);

  it("splits after the given word index", () => {
    const result = splitBlock(source, 0, makeId);
    expect(result).not.toBeNull();
    const [left, right] = result!;
    expect(left.words.map((w) => w.text)).toEqual(["a"]);
    expect(right.words.map((w) => w.text)).toEqual(["b", "c"]);
  });

  it("recomputes both spans", () => {
    const [left, right] = splitBlock(source, 0, makeId)!;
    expect(left.endFrame).toBe(10);
    expect(right.startFrame).toBe(10);
  });

  it("keeps the original id on the left half", () => {
    const [left] = splitBlock(source, 1, makeId)!;
    expect(left.id).toBe("blk");
  });

  it("refuses a split that would empty a half", () => {
    expect(splitBlock(source, -1, makeId)).toBeNull();
    expect(splitBlock(source, 2, makeId)).toBeNull();
  });
});

describe("mergeBlocks", () => {
  it("concatenates in timeline order regardless of argument order", () => {
    const first = block([word("a", 0, 10)], "first");
    const second = block([word("b", 10, 20)], "second");

    expect(mergeBlocks(second, first).words.map((w) => w.text)).toEqual(["a", "b"]);
  });

  it("spans both blocks", () => {
    const merged = mergeBlocks(block([word("a", 0, 10)]), block([word("b", 30, 50)]));
    expect(merged.startFrame).toBe(0);
    expect(merged.endFrame).toBe(50);
  });
});

describe("editWord", () => {
  it("changes text but keeps timing", () => {
    const edited = editWord(block([word("teh", 0, 10)]), 0, "the");
    expect(edited.words[0]).toEqual({ text: "the", startFrame: 0, endFrame: 10, confidence: 1 });
  });

  it("ignores an out-of-range index", () => {
    const source = block([word("a", 0, 10)]);
    expect(editWord(source, 5, "x")).toBe(source);
  });
});

describe("shiftBlock", () => {
  it("moves the block and its words together", () => {
    const shifted = shiftBlock(block([word("a", 10, 20), word("b", 20, 30)]), 15);
    expect(shifted.startFrame).toBe(25);
    expect(shifted.words[0]!.startFrame).toBe(25);
    expect(shifted.words[1]!.endFrame).toBe(45);
  });

  it("clamps so a block cannot cross frame 0", () => {
    const shifted = shiftBlock(block([word("a", 10, 20)]), -50);
    expect(shifted.startFrame).toBe(0);
    expect(shifted.words[0]!.startFrame).toBe(0);
  });

  it("is a no-op for zero delta", () => {
    const source = block([word("a", 10, 20)]);
    expect(shiftBlock(source, 0)).toBe(source);
  });
});

describe("retimeBlock", () => {
  it("scales word timings into a new, wider window", () => {
    // Block spans 10..30 (span 20); retime to 100..140 (span 40) → 2× scale.
    const result = retimeBlock(block([word("a", 10, 20), word("b", 20, 30)]), 100, 140);
    expect(result.startFrame).toBe(100);
    expect(result.endFrame).toBe(140);
    expect(result.words.map((w) => [w.startFrame, w.endFrame])).toEqual([
      [100, 120],
      [120, 140],
    ]);
  });

  it("compresses into a narrower window", () => {
    const result = retimeBlock(block([word("a", 0, 20), word("b", 20, 40)]), 0, 20);
    expect(result.endFrame).toBe(20);
    expect(result.words.map((w) => w.endFrame)).toEqual([10, 20]);
  });

  it("enforces at least one frame per word", () => {
    const result = retimeBlock(block([word("a", 0, 10), word("b", 10, 20)]), 50, 50);
    expect(result.endFrame - result.startFrame).toBeGreaterThanOrEqual(2);
  });

  it("never lets the window start below zero", () => {
    expect(retimeBlock(block([word("a", 0, 10)]), -20, 10).startFrame).toBe(0);
  });
});

describe("blockAtFrame", () => {
  const blocks = [block([word("a", 0, 30)], "one"), block([word("b", 30, 60)], "two")];

  it("finds the block covering a frame", () => {
    expect(blockAtFrame(blocks, 15)?.id).toBe("one");
    expect(blockAtFrame(blocks, 45)?.id).toBe("two");
  });

  it("treats block ranges as half-open", () => {
    // Frame 30 belongs to the second block, not the first.
    expect(blockAtFrame(blocks, 30)?.id).toBe("two");
  });

  it("returns null in a gap or past the end", () => {
    expect(blockAtFrame(blocks, 100)).toBeNull();
  });
});

describe("activeWordIndex", () => {
  const b = block([word("one", 0, 10), word("two", 10, 20), word("three", 20, 30)]);

  it("tracks the word under the playhead", () => {
    expect(activeWordIndex(b, 5)).toBe(0);
    expect(activeWordIndex(b, 15)).toBe(1);
    expect(activeWordIndex(b, 25)).toBe(2);
  });

  it("holds the previous word through a gap rather than flickering off", () => {
    const gapped = block([word("one", 0, 10), word("two", 20, 30)]);
    // Frame 15 is between words; the first stays highlighted.
    expect(activeWordIndex(gapped, 15)).toBe(0);
  });

  it("is -1 before the first word", () => {
    expect(activeWordIndex(b, -5)).toBe(-1);
  });
});

describe("caption presets", () => {
  it("ships the named creator styles", () => {
    const names = CAPTION_PRESETS.map((p) => p.name);
    expect(names).toContain("TikTok");
    expect(names).toContain("Hormozi");
    expect(names).toContain("MrBeast");
  });

  it("gives Hormozi one word per block", () => {
    expect(getCaptionPreset("core.captions.hormozi").wordsPerBlock).toBe(1);
  });

  it("falls back to the default for an unknown id", () => {
    expect(getCaptionPreset("nope").id).toBe(DEFAULT_CAPTION_PRESET_ID);
  });

  it("serializes to JSON losslessly (presets are data)", () => {
    const preset = getCaptionPreset("core.captions.tiktok");
    expect(JSON.parse(JSON.stringify(preset))).toEqual(preset);
  });
});

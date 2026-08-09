"use client";

import { Scissors, Trash2 } from "lucide-react";
import type { CaptionBlock, CaptionTrackData } from "@opencut/types";
import { editWord, mergeBlocks, splitBlock } from "@opencut/caption-engine";
import { formatTimecode } from "@opencut/timeline-engine";
import { createId } from "@opencut/utils";
import { cn } from "@opencut/ui";
import { useEditorStore } from "@/state/editorStore";
import type { EditorUpdateCaptionTrack } from "./types";

/**
 * The transcript editor.
 *
 * Blocks are listed in time order; each word is individually editable, and
 * low-confidence words (which the placeholder recogniser marks with confidence
 * 0) are flagged so the user knows what to review. Clicking a block seeks the
 * playhead to it. Split/merge/delete operate through the pure caption-engine
 * ops, each a single undo step.
 */
export function CaptionEditor({
  track,
  onUpdate,
}: {
  track: CaptionTrackData;
  onUpdate: EditorUpdateCaptionTrack;
}) {
  const fps = useEditorStore((state) => state.project.settings.frameRate);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);

  const replaceBlock = (blockId: string, next: CaptionBlock, label: string) =>
    onUpdate(
      track.id,
      (t) => ({ ...t, blocks: t.blocks.map((b) => (b.id === blockId ? next : b)) }),
      label,
    );

  const deleteBlock = (blockId: string) =>
    onUpdate(
      track.id,
      (t) => ({ ...t, blocks: t.blocks.filter((b) => b.id !== blockId) }),
      "Delete caption",
    );

  const mergeWithNext = (index: number) =>
    onUpdate(
      track.id,
      (t) => {
        const a = t.blocks[index];
        const b = t.blocks[index + 1];
        if (!a || !b) return t;
        const merged = mergeBlocks(a, b);
        // Replace the pair with the merged block, preserving order.
        const blocks = [...t.blocks.slice(0, index), merged, ...t.blocks.slice(index + 2)];
        return { ...t, blocks };
      },
      "Merge captions",
    );

  const splitAfterWord = (blockId: string, afterIndex: number) =>
    onUpdate(
      track.id,
      (t) => {
        const index = t.blocks.findIndex((b) => b.id === blockId);
        const block = t.blocks[index];
        if (!block) return t;
        const result = splitBlock(block, afterIndex, () => createId("cap"));
        if (!result) return t;
        return {
          ...t,
          blocks: [...t.blocks.slice(0, index), ...result, ...t.blocks.slice(index + 1)],
        };
      },
      "Split caption",
    );

  if (track.blocks.length === 0) {
    return <p className="text-text-tertiary text-2xs">No caption blocks.</p>;
  }

  return (
    <ul className="scrollbar-slim flex max-h-[40vh] flex-col gap-1 overflow-auto">
      {track.blocks.map((block, index) => (
        <li
          key={block.id}
          className="border-border-subtle bg-surface-raised group rounded-sm border p-1.5"
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              onClick={() => setPlayhead(block.startFrame)}
              className="tabular text-text-tertiary hover:text-accent text-2xs"
              title="Seek to this caption"
            >
              {formatTimecode(block.startFrame, fps)}
            </button>
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {index < track.blocks.length - 1 && (
                <button
                  onClick={() => mergeWithNext(index)}
                  title="Merge with next"
                  className="text-text-tertiary hover:text-text-primary text-2xs px-1"
                >
                  merge↓
                </button>
              )}
              <button
                onClick={() => deleteBlock(block.id)}
                aria-label="Delete caption"
                className="text-text-tertiary hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {block.words.map((word, wordIndex) => (
              <span key={wordIndex} className="inline-flex items-center">
                <input
                  value={word.text}
                  onChange={(event) =>
                    replaceBlock(
                      block.id,
                      editWord(block, wordIndex, event.target.value),
                      "Edit caption",
                    )
                  }
                  size={Math.max(2, word.text.length)}
                  className={cn(
                    "bg-surface-input rounded-xs px-1 text-xs focus:outline-none",
                    // Low confidence → the placeholder or an uncertain word; flag it.
                    word.confidence < 0.5
                      ? "text-warning ring-warning/40 ring-1"
                      : "text-text-primary",
                  )}
                />
                {/* Split point between words. */}
                {wordIndex < block.words.length - 1 && (
                  <button
                    onClick={() => splitAfterWord(block.id, wordIndex)}
                    title="Split here"
                    className="text-text-tertiary hover:text-accent mx-0.5"
                  >
                    <Scissors size={9} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

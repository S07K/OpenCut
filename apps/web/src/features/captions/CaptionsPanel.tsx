"use client";

import { useCallback, useState } from "react";
import { Captions as CaptionsIcon, Loader2, Plus, Trash2 } from "lucide-react";
import type { CaptionTrackData, CaptionWord, Frame } from "@cutaway/types";
import {
  buildBlocks,
  CAPTION_PRESETS,
  DEFAULT_CAPTION_PRESET_ID,
  getCaptionPreset,
} from "@cutaway/caption-engine";
import { createId } from "@cutaway/utils";
import { Button, cn } from "@cutaway/ui";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "@/state/editorStore";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { getTranscriptionProvider } from "./transcription";
import { CaptionEditor } from "./CaptionEditor";
import type { EditorUpdateCaptionTrack } from "./types";

/**
 * Captions sidebar: generate a transcript, pick a style, and edit blocks.
 *
 * Generation walks the spec pipeline — media → transcribe → word timings →
 * blocks → an editable track — with the transcription provider swappable behind
 * its interface. The default provider is a placeholder (no speech recognition
 * yet), which the confidence "review" affordance in the editor makes honest.
 */
export function CaptionsPanel() {
  const project = useEditorStore((state) => state.project);
  const mediaAssets = useEditorStore(
    useShallow((state) => Object.values(state.project.entities.media)),
  );
  const captionTracks = useEditorStore(
    useShallow((state) => Object.values(state.project.entities.captionTracks)),
  );
  const upsertCaptionTrack = useEditorStore((state) => state.upsertCaptionTrack);
  const updateCaptionTrack = useEditorStore((state) => state.updateCaptionTrack);
  const removeCaptionTrack = useEditorStore((state) => state.removeCaptionTrack);
  const playhead = useEditorStore((state) => state.playhead);
  const { store } = useMediaImportContext();

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Generate from the first media asset that has audio — the common single-clip
  // case. Picking the source explicitly is a refinement for multi-clip projects.
  const audioAsset = mediaAssets.find(
    (asset) => asset.metadata.hasAudio && asset.source.type === "indexeddb",
  );

  const generate = useCallback(async () => {
    if (!audioAsset || audioAsset.source.type !== "indexeddb") return;
    setBusy(true);
    setError(null);
    setProgress(0);

    try {
      const blob = await store().get(audioAsset.source.key);
      if (!blob) throw new Error("Media bytes not found");

      const provider = getTranscriptionProvider();
      const { words, language } = await provider.transcribe({
        media: blob,
        language: "en",
        frameRate: project.settings.frameRate,
        onProgress: setProgress,
      });

      const preset = getCaptionPreset(DEFAULT_CAPTION_PRESET_ID);
      const gapFrames = Math.round(project.settings.frameRate * 0.6);
      const blocks = buildBlocks(words, preset.wordsPerBlock, gapFrames, () => createId("cap"));

      const track: CaptionTrackData = {
        id: createId("captions"),
        sourceMediaId: audioAsset.id,
        language,
        blocks,
        presetId: DEFAULT_CAPTION_PRESET_ID,
      };
      upsertCaptionTrack(track, "Generate captions");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transcription failed");
    } finally {
      setBusy(false);
    }
  }, [audioAsset, store, project.settings.frameRate, upsertCaptionTrack]);

  // Manually add a caption: type text, and it becomes styled blocks at the
  // playhead — no transcription needed. Words are timed evenly, and split into
  // blocks by the active preset so they animate word-by-word like generated ones.
  const addCaption = useCallback(() => {
    const text = draft.trim();
    if (!text) return;

    const fps = project.settings.frameRate;
    const words = timeWords(text, playhead, fps);
    const preset = getCaptionPreset(existingPresetId(captionTracks) ?? DEFAULT_CAPTION_PRESET_ID);
    const gapFrames = Math.round(fps * 0.6);
    const blocks = buildBlocks(words, preset.wordsPerBlock, gapFrames, () => createId("cap"));

    const existing = captionTracks[0];
    if (existing) {
      updateCaptionTrack(
        existing.id,
        (t) => ({
          ...t,
          blocks: [...t.blocks, ...blocks].sort((a, b) => a.startFrame - b.startFrame),
        }),
        "Add caption",
      );
    } else {
      upsertCaptionTrack(
        {
          id: createId("captions"),
          sourceMediaId: null,
          language: "en",
          blocks,
          presetId: DEFAULT_CAPTION_PRESET_ID,
        },
        "Add caption",
      );
    }
    setDraft("");
  }, [
    draft,
    playhead,
    project.settings.frameRate,
    captionTracks,
    updateCaptionTrack,
    upsertCaptionTrack,
  ]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Manual add — type a caption and drop it at the playhead, no audio or
          transcription required. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addCaption();
            }}
            placeholder="Type a caption…"
            className="bg-surface-input text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 rounded-xs px-2 py-1 text-xs focus:outline-none"
          />
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus size={13} />}
            disabled={draft.trim().length === 0}
            onClick={addCaption}
          >
            Add
          </Button>
        </div>
        <p className="text-text-tertiary text-2xs">Adds a styled caption at the playhead.</p>
      </div>

      {captionTracks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CaptionsIcon size={20} className="text-text-tertiary" />
          {audioAsset ? (
            <>
              <p className="text-text-secondary text-xs">Generate captions from your audio.</p>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void generate()}>
                {busy ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> {Math.round(progress * 100)}%
                  </>
                ) : (
                  "Generate captions"
                )}
              </Button>
              <p className="text-text-tertiary text-2xs max-w-[220px]">
                Uses on-device transcription. The default build ships a placeholder recogniser —
                edit the words, or plug in Whisper.
              </p>
            </>
          ) : (
            <p className="text-text-tertiary text-xs">Import audio or video to caption it.</p>
          )}
          {error && <p className="text-danger text-2xs">{error}</p>}
        </div>
      ) : (
        captionTracks.map((track) => (
          <CaptionTrackSection
            key={track.id}
            track={track}
            onUpdate={updateCaptionTrack}
            onRemove={() => removeCaptionTrack(track.id)}
          />
        ))
      )}
    </div>
  );
}

function CaptionTrackSection({
  track,
  onUpdate,
  onRemove,
}: {
  track: CaptionTrackData;
  onUpdate: EditorUpdateCaptionTrack;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs text-text-tertiary font-medium tracking-wide uppercase">
          Style
        </span>
        <button
          onClick={onRemove}
          aria-label="Remove captions"
          className="text-text-tertiary hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {CAPTION_PRESETS.map((preset) => (
          <button
            key={preset.id}
            aria-pressed={preset.id === track.presetId}
            onClick={() =>
              onUpdate(track.id, (t) => ({ ...t, presetId: preset.id }), "Change caption style")
            }
            className={cn(
              "text-2xs rounded-sm border px-2 py-1 transition-colors",
              preset.id === track.presetId
                ? "border-accent text-text-primary bg-accent-muted"
                : "border-border-default bg-surface-raised text-text-secondary hover:border-accent",
            )}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <CaptionEditor track={track} onUpdate={onUpdate} />
    </div>
  );
}

/** Splits text into evenly-timed words starting at `startFrame` (~0.4s each). */
function timeWords(text: string, startFrame: Frame, fps: number): CaptionWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const perWord = Math.max(1, Math.round(fps * 0.4));
  return tokens.map((word, index) => ({
    text: word,
    startFrame: startFrame + index * perWord,
    endFrame: startFrame + (index + 1) * perWord,
    // Full confidence: this is the user's own text, not a guess to review.
    confidence: 1,
  }));
}

/** The style of the existing caption track, so a manual caption matches it. */
function existingPresetId(tracks: readonly CaptionTrackData[]): string | null {
  return tracks[0]?.presetId ?? null;
}

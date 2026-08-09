"use client";

import { useCallback, useState } from "react";
import { Captions as CaptionsIcon, Loader2, Trash2 } from "lucide-react";
import type { CaptionTrackData } from "@opencut/types";
import {
  buildBlocks,
  CAPTION_PRESETS,
  DEFAULT_CAPTION_PRESET_ID,
  getCaptionPreset,
} from "@opencut/caption-engine";
import { createId } from "@opencut/utils";
import { Button, cn } from "@opencut/ui";
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
  const { store } = useMediaImportContext();

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-3 p-3">
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

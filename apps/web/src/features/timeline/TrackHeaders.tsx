"use client";

import { Eye, EyeOff, Lock, LockOpen, Plus, Volume2, VolumeX } from "lucide-react";
import { IconButton, cn } from "@opencut/ui";
import { useShallow } from "zustand/react/shallow";
import { RULER_HEIGHT, TRACK_GAP } from "./geometry";
import { selectOrderedTracks, useEditorStore } from "@/state/editorStore";

/**
 * Per-track controls, rendered as DOM alongside the canvas.
 *
 * These stay in the DOM deliberately. They are a short, static list — so the
 * canvas performance argument does not apply — and real buttons give us
 * focus, keyboard activation, and screen-reader labels for free, which would
 * otherwise have to be reimplemented against a canvas.
 */
export function TrackHeaders() {
  const tracks = useEditorStore(useShallow(selectOrderedTracks));
  const setTrackFlag = useEditorStore((state) => state.setTrackFlag);
  const addTrack = useEditorStore((state) => state.addTrack);

  return (
    <div className="border-border-subtle bg-surface-panel flex h-full w-(--size-track-header-width) shrink-0 flex-col border-r">
      {/* Spacer aligning the first track header with the first canvas lane. */}
      <div className="border-border-subtle shrink-0 border-b" style={{ height: RULER_HEIGHT }} />

      {tracks.map((track) => (
        <div
          key={track.id}
          className={cn(
            "flex shrink-0 items-center gap-1 px-2",
            "border-border-subtle/50 border-b",
          )}
          style={{ height: track.height, marginBottom: TRACK_GAP }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-text-primary truncate text-xs font-medium">{track.name}</p>
            <p className="text-2xs text-text-tertiary capitalize">{track.kind}</p>
          </div>

          <div className="flex shrink-0 items-center">
            {track.kind === "audio" ? (
              <IconButton
                size="sm"
                label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                active={track.muted}
                onClick={() => setTrackFlag(track.id, "muted", !track.muted)}
              >
                {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </IconButton>
            ) : (
              <IconButton
                size="sm"
                label={track.hidden ? `Show ${track.name}` : `Hide ${track.name}`}
                active={track.hidden}
                onClick={() => setTrackFlag(track.id, "hidden", !track.hidden)}
              >
                {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </IconButton>
            )}

            <IconButton
              size="sm"
              label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
              active={track.locked}
              onClick={() => setTrackFlag(track.id, "locked", !track.locked)}
            >
              {track.locked ? <Lock size={13} /> : <LockOpen size={13} />}
            </IconButton>
          </div>
        </div>
      ))}

      {/* Add-track controls. A new video track lands on top (front); audio at the
          bottom — enough to layer clips (backgrounds, overlays, picture-in-picture). */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          onClick={() => addTrack("video")}
          className={cn(
            "border-border-default bg-surface-raised text-text-secondary text-2xs flex flex-1 items-center justify-center gap-1 rounded-sm border py-1",
            "duration-fast hover:border-accent hover:text-text-primary transition-colors",
          )}
        >
          <Plus size={12} /> Video
        </button>
        <button
          onClick={() => addTrack("audio")}
          className={cn(
            "border-border-default bg-surface-raised text-text-secondary text-2xs flex flex-1 items-center justify-center gap-1 rounded-sm border py-1",
            "duration-fast hover:border-accent hover:text-text-primary transition-colors",
          )}
        >
          <Plus size={12} /> Audio
        </button>
      </div>
    </div>
  );
}

"use client";

import { Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX } from "lucide-react";
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

  return (
    <div className="flex h-full w-(--size-track-header-width) shrink-0 flex-col border-r border-border-subtle bg-surface-panel">
      {/* Spacer aligning the first track header with the first canvas lane. */}
      <div
        className="shrink-0 border-b border-border-subtle"
        style={{ height: RULER_HEIGHT }}
      />

      {tracks.map((track) => (
        <div
          key={track.id}
          className={cn(
            "flex shrink-0 items-center gap-1 px-2",
            "border-b border-border-subtle/50",
          )}
          style={{ height: track.height, marginBottom: TRACK_GAP }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-text-primary">{track.name}</p>
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
    </div>
  );
}

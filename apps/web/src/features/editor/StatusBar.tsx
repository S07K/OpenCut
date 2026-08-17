"use client";

import { WifiOff } from "lucide-react";
import { formatDuration } from "@cutaway/timeline-engine";
import { useEditorStore } from "@/state/editorStore";
import { SaveIndicator } from "@/features/project/SaveIndicator";

export function StatusBar() {
  const duration = useEditorStore((state) => state.project.durationFrames);
  const fps = useEditorStore((state) => state.project.settings.frameRate);
  const clipCount = useEditorStore((state) => Object.keys(state.project.entities.clips).length);
  const zoom = useEditorStore((state) => state.pixelsPerFrame);

  return (
    <footer className="border-border-subtle bg-surface-panel text-2xs text-text-tertiary flex h-(--size-statusbar-height) shrink-0 items-center gap-3 border-t px-3">
      {/* Stated plainly and permanently: this is the project's core promise, so
          it belongs in the chrome, not in a marketing page. */}
      <span className="flex items-center gap-1">
        <WifiOff size={11} />
        Local only — no account, no upload
      </span>

      <div className="bg-border-subtle h-3 w-px" />

      <span className="tabular">{clipCount} clips</span>
      <span className="tabular">{formatDuration(duration, fps)}</span>

      <div className="flex-1" />

      <span className="tabular">{zoom.toFixed(1)} px/frame</span>

      <div className="bg-border-subtle h-3 w-px" />

      <SaveIndicator />
    </footer>
  );
}

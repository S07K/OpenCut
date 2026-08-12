"use client";

import {
  Braces,
  Magnet,
  Scissors,
  SquareChevronLeft,
  SquareChevronRight,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { IconButton, Panel } from "@opencut/ui";
import { formatTimecode } from "@opencut/timeline-engine";
import { TimelineCanvas } from "./TimelineCanvas";
import { TrackHeaders } from "./TrackHeaders";
import { useEditorStore } from "@/state/editorStore";

export function TimelinePanel() {
  const playhead = useEditorStore((state) => state.playhead);
  const fps = useEditorStore((state) => state.project.settings.frameRate);
  const duration = useEditorStore((state) => state.project.durationFrames);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const selectionCount = useEditorStore((state) => state.selectedClipIds.length);

  const inPoint = useEditorStore((state) => state.inPoint);
  const outPoint = useEditorStore((state) => state.outPoint);

  const zoomBy = useEditorStore((state) => state.zoomBy);
  const toggleSnap = useEditorStore((state) => state.toggleSnap);
  const splitAtPlayhead = useEditorStore((state) => state.splitAtPlayhead);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const setInPoint = useEditorStore((state) => state.setInPoint);
  const setOutPoint = useEditorStore((state) => state.setOutPoint);
  const clearInOut = useEditorStore((state) => state.clearInOut);

  const hasRange = inPoint !== null || outPoint !== null;

  return (
    <Panel bare className="border-border-subtle border-t">
      <div className="flex h-full flex-col">
        <div className="border-border-subtle flex h-9 shrink-0 items-center gap-1 border-b px-2">
          <span className="tabular text-text-primary text-sm">{formatTimecode(playhead, fps)}</span>
          <span className="tabular text-text-tertiary text-xs">
            / {formatTimecode(duration, fps)}
          </span>

          <div className="bg-border-subtle mx-2 h-4 w-px" />

          <IconButton size="sm" label="Split at playhead (S)" onClick={splitAtPlayhead}>
            <Scissors size={14} />
          </IconButton>
          <IconButton
            size="sm"
            label="Ripple delete selection (Delete)"
            disabled={selectionCount === 0}
            onClick={deleteSelected}
          >
            <Trash2 size={14} />
          </IconButton>
          <IconButton
            size="sm"
            label="Toggle snapping (N)"
            active={snapEnabled}
            onClick={toggleSnap}
          >
            <Magnet size={14} />
          </IconButton>

          <div className="bg-border-subtle mx-2 h-4 w-px" />

          <IconButton
            size="sm"
            label="Set export in-point at playhead (I)"
            active={inPoint !== null}
            onClick={() => setInPoint(playhead)}
          >
            <SquareChevronRight size={14} />
          </IconButton>
          <IconButton
            size="sm"
            label="Set export out-point at playhead (O)"
            active={outPoint !== null}
            onClick={() => setOutPoint(playhead)}
          >
            <SquareChevronLeft size={14} />
          </IconButton>
          {hasRange && (
            <IconButton size="sm" label="Clear export range" onClick={clearInOut}>
              <Braces size={14} />
            </IconButton>
          )}

          <div className="flex-1" />

          {selectionCount > 0 && (
            <span className="text-text-tertiary mr-2 text-xs">{selectionCount} selected</span>
          )}

          <IconButton size="sm" label="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
            <ZoomOut size={14} />
          </IconButton>
          <IconButton size="sm" label="Zoom in" onClick={() => zoomBy(1.3)}>
            <ZoomIn size={14} />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1">
          <TrackHeaders />
          <div className="min-w-0 flex-1">
            <TimelineCanvas />
          </div>
        </div>
      </div>
    </Panel>
  );
}

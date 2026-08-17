"use client";

import { useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { IconButton } from "@cutaway/ui";
import { formatTimecode } from "@cutaway/timeline-engine";
import { useEditorStore } from "@/state/editorStore";
import { PreviewStage } from "@/features/preview/PreviewStage";
import { MaskOverlay } from "@/features/masks/MaskOverlay";
import { useElementSize } from "@/hooks/useElementSize";

/**
 * Video preview surface and transport controls.
 *
 * The compositor (PixiJS) mounts into `previewRef` in Phase 2. What exists now
 * is the *frame*: correct aspect-ratio fitting, safe guides, and transport —
 * the parts that are pure layout and would otherwise be rebuilt around the
 * renderer later.
 */
export function PreviewPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showGuides, setShowGuides] = useState(true);

  const resolution = useEditorStore((state) => state.project.settings.resolution);
  const background = useEditorStore((state) => state.project.settings.backgroundColor);
  const playhead = useEditorStore((state) => state.playhead);
  const duration = useEditorStore((state) => state.project.durationFrames);
  const fps = useEditorStore((state) => state.project.settings.frameRate);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  const togglePlaying = useEditorStore((state) => state.togglePlaying);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);

  // Fit the project's aspect ratio inside the available space, letterboxing as
  // needed. Derived during render rather than stored in state — it is a pure
  // function of the container size and the project resolution, so keeping a
  // second copy in state could only ever disagree with them.
  const containerSize = useElementSize(containerRef);

  const stageSize = (() => {
    const padding = 32;
    const availableWidth = Math.max(0, containerSize.width - padding);
    const availableHeight = Math.max(0, containerSize.height - padding);
    const projectAspect = resolution.width / resolution.height;

    const width = Math.min(availableWidth, availableHeight * projectAspect);
    return { width, height: width / projectAspect };
  })();

  return (
    <div className="bg-surface-base flex h-full flex-col">
      <div ref={containerRef} className="bg-canvas relative min-h-0 flex-1">
        <div className="absolute inset-0 grid place-items-center">
          <div
            className="shadow-panel relative"
            style={{
              width: stageSize.width,
              height: stageSize.height,
              backgroundColor: background,
            }}
          >
            {stageSize.width > 0 && (
              <PreviewStage width={stageSize.width} height={stageSize.height} />
            )}

            {showGuides && <SafeGuides />}

            {stageSize.width > 0 && (
              <MaskOverlay
                width={stageSize.width}
                height={stageSize.height}
                resolution={resolution}
              />
            )}
          </div>
        </div>
      </div>

      <div className="border-border-subtle bg-surface-panel flex h-11 shrink-0 items-center gap-1 border-t px-3">
        <span className="tabular text-text-primary w-24 text-sm">
          {formatTimecode(playhead, fps)}
        </span>

        <div className="flex flex-1 items-center justify-center gap-0.5">
          <IconButton label="Go to start" onClick={() => setPlayhead(0)}>
            <SkipBack size={15} />
          </IconButton>
          <IconButton label="Previous frame" onClick={() => setPlayhead(playhead - 1)}>
            <ChevronsLeft size={15} />
          </IconButton>
          <IconButton
            label={isPlaying ? "Pause (Space)" : "Play (Space)"}
            variant="secondary"
            onClick={togglePlaying}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          </IconButton>
          <IconButton label="Next frame" onClick={() => setPlayhead(playhead + 1)}>
            <ChevronsRight size={15} />
          </IconButton>
          <IconButton label="Go to end" onClick={() => setPlayhead(duration)}>
            <SkipForward size={15} />
          </IconButton>
        </div>

        <div className="flex w-24 justify-end">
          <IconButton
            size="sm"
            label="Toggle safe guides"
            active={showGuides}
            onClick={() => setShowGuides((value) => !value)}
          >
            <span className="text-2xs font-semibold">SAFE</span>
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/**
 * Title- and action-safe guides.
 *
 * The inner box is the 80% title-safe area; the outer is 90% action-safe. These
 * are the broadcast conventions, and they map closely to where TikTok and Reels
 * overlay their own UI — which is the practical reason creators need them.
 */
function SafeGuides() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute inset-[5%] border border-white/20" />
      <div className="absolute inset-[10%] border border-white/15" />
      <div className="absolute top-1/2 right-0 left-0 h-px bg-white/10" />
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/10" />
    </div>
  );
}

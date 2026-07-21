"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Frame, Id } from "@opencut/types";
import { DEFAULT_SNAP_THRESHOLD_PX, snapClipDrag } from "@opencut/timeline-engine";
import {
  hitTestClip,
  layoutTracks,
  RULER_HEIGHT,
  totalTracksHeight,
  trackAtY,
  visibleClips,
  xToFrame,
  type ClipRect,
  type TimelineViewport,
} from "./geometry";
import { readTheme, renderTimeline, type TimelineTheme } from "./renderer";
import { useElementSize } from "@/hooks/useElementSize";
import { selectClipsArray, selectOrderedTracks, useEditorStore } from "@/state/editorStore";

/**
 * The canvas timeline.
 *
 * Canvas rather than DOM from the start: a DOM timeline degrades badly past
 * roughly 200 clips, and retrofitting canvas later means rewriting every
 * interaction. The cost is that accessibility must be built explicitly —
 * handled here with a focusable surface and keyboard commands, with a DOM track
 * header column alongside for per-track controls.
 */

type DragMode =
  | { kind: "none" }
  | { kind: "seek" }
  | {
      kind: "move-clip";
      clipId: Id;
      /** Frame offset between the pointer and the clip's start, held constant. */
      grabOffsetFrames: number;
    };

export function TimelineCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<TimelineTheme | null>(null);
  const clipRectsRef = useRef<ClipRect[]>([]);
  const dragRef = useRef<DragMode>({ kind: "none" });

  const [snapGuideFrame, setSnapGuideFrame] = useState<Frame | null>(null);

  // Shared with the preview: measuring via ResizeObserver alone is not reliable
  // enough for first paint (see the hook for why).
  const size = useElementSize(containerRef);

  const project = useEditorStore((state) => state.project);
  const playhead = useEditorStore((state) => state.playhead);
  const pixelsPerFrame = useEditorStore((state) => state.pixelsPerFrame);
  const scrollFrame = useEditorStore((state) => state.scrollFrame);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);

  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const setScrollFrame = useEditorStore((state) => state.setScrollFrame);
  const zoomBy = useEditorStore((state) => state.zoomBy);
  const selectClips = useEditorStore((state) => state.selectClips);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const moveClipTo = useEditorStore((state) => state.moveClipTo);

  // `useShallow` is load-bearing, not an optimization: these selectors build a
  // new array on every call, and zustand v5 compares snapshots by reference.
  // Without it React sees a changed snapshot every render and loops forever.
  const tracks = useEditorStore(useShallow(selectOrderedTracks));
  const clips = useEditorStore(useShallow(selectClipsArray));
  const markers = useMemo(
    () => Object.values(project.entities.markers),
    [project.entities.markers],
  );
  const fps = project.settings.frameRate;

  // --- Drawing ------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || size.width === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    themeRef.current ??= readTheme(container);

    // Back the canvas at device resolution and scale the context, or every
    // line and label renders soft on a HiDPI display.
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(size.width * dpr);
    const targetHeight = Math.round(size.height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const viewport: TimelineViewport = {
      scrollFrame,
      pixelsPerFrame,
      width: size.width,
      height: size.height,
    };

    const layouts = layoutTracks(tracks);
    const rects = visibleClips(clips, layouts, viewport);
    clipRectsRef.current = rects;

    renderTimeline({
      ctx,
      viewport,
      layouts,
      clipRects: rects,
      markers,
      playhead,
      selectedClipIds,
      snapGuideFrame,
      fps,
      theme: themeRef.current,
    });
  }, [
    size,
    scrollFrame,
    pixelsPerFrame,
    tracks,
    clips,
    markers,
    playhead,
    selectedClipIds,
    snapGuideFrame,
    fps,
  ]);

  useEffect(() => {
    // Drawing is scheduled rather than run inline so that several store updates
    // in one tick coalesce into a single paint.
    const handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [draw]);

  // --- Pointer interaction -------------------------------------------------

  const localPoint = useCallback((event: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const viewportNow = useCallback(
    (): TimelineViewport => ({
      scrollFrame,
      pixelsPerFrame,
      width: size.width,
      height: size.height,
    }),
    [scrollFrame, pixelsPerFrame, size],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.focus();
      canvas.setPointerCapture(event.pointerId);

      const { x, y } = localPoint(event);
      const viewport = viewportNow();
      const frame = Math.round(xToFrame(x, viewport));

      // Clicking the ruler always seeks, never selects — the ruler is the
      // scrub surface and users expect it to be unambiguous.
      if (y <= RULER_HEIGHT) {
        dragRef.current = { kind: "seek" };
        setPlayhead(frame);
        return;
      }

      const hit = hitTestClip(x, y, clipRectsRef.current);
      if (!hit) {
        clearSelection();
        dragRef.current = { kind: "seek" };
        setPlayhead(frame);
        return;
      }

      const clip = project.entities.clips[hit.clipId];
      if (!clip) return;

      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (additive) {
        selectClips(
          selectedClipIds.includes(hit.clipId)
            ? selectedClipIds.filter((id) => id !== hit.clipId)
            : [...selectedClipIds, hit.clipId],
        );
      } else if (!selectedClipIds.includes(hit.clipId)) {
        selectClips([hit.clipId]);
      }

      if (clip.locked) return;

      dragRef.current = {
        kind: "move-clip",
        clipId: hit.clipId,
        grabOffsetFrames: frame - clip.startFrame,
      };
    },
    [
      localPoint,
      viewportNow,
      setPlayhead,
      clearSelection,
      project.entities.clips,
      selectClips,
      selectedClipIds,
    ],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag.kind === "none") return;

      const { x, y } = localPoint(event);
      const viewport = viewportNow();
      const frame = Math.round(xToFrame(x, viewport));

      if (drag.kind === "seek") {
        setPlayhead(frame);
        return;
      }

      const clip = project.entities.clips[drag.clipId];
      if (!clip) return;

      const proposedStart = frame - drag.grabOffsetFrames;

      let nextStart = Math.max(0, proposedStart);
      let guide: Frame | null = null;

      if (snapEnabled) {
        const result = snapClipDrag(proposedStart, clip.durationFrames, {
          clips,
          markers,
          playhead,
          excludeClipIds: new Set([drag.clipId]),
          pixelsPerFrame,
          thresholdPx: DEFAULT_SNAP_THRESHOLD_PX,
        });
        nextStart = Math.max(0, result.frame);
        guide = result.target ? result.target.frame : null;
      }

      setSnapGuideFrame(guide);

      const layouts = layoutTracks(tracks);
      const targetTrack = trackAtY(y, layouts);
      // Only allow cross-track moves between compatible kinds; dropping video
      // onto an audio lane would produce a clip that can never render.
      const canRetarget =
        targetTrack !== null &&
        !targetTrack.locked &&
        isCompatible(clip.content.kind, targetTrack.kind);

      moveClipTo(drag.clipId, nextStart, canRetarget ? targetTrack.id : undefined);
    },
    [
      localPoint,
      viewportNow,
      setPlayhead,
      project.entities.clips,
      snapEnabled,
      clips,
      markers,
      playhead,
      pixelsPerFrame,
      tracks,
      moveClipTo,
    ],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { kind: "none" };
    setSnapGuideFrame(null);
    canvasRef.current?.releasePointerCapture(event.pointerId);
  }, []);

  // --- Wheel: scroll and zoom ---------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      // Registered manually because React's synthetic wheel listener is
      // passive, and a passive listener cannot preventDefault — the page would
      // scroll behind the timeline.
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        // Pinch-zoom and ctrl+wheel both arrive here; zoom around the cursor so
        // the frame under the pointer stays put.
        const rect = canvas.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const state = useEditorStore.getState();
        const frameAtPointer = state.scrollFrame + pointerX / state.pixelsPerFrame;

        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        state.zoomBy(factor);

        const next = useEditorStore.getState();
        next.setScrollFrame(frameAtPointer - pointerX / next.pixelsPerFrame);
        return;
      }

      const state = useEditorStore.getState();
      const deltaFrames = event.deltaX / state.pixelsPerFrame;
      state.setScrollFrame(state.scrollFrame + deltaFrames);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  const contentHeight = totalTracksHeight(tracks);

  return (
    <div
      ref={containerRef}
      className="bg-surface-base relative h-full w-full overflow-hidden"
      style={{ minHeight: contentHeight }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Timeline"
        className="block h-full w-full cursor-default focus-visible:outline-none"
        style={{ width: size.width, height: size.height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}

/** Which clip kinds a track kind will accept. */
function isCompatible(clipKind: string, trackKind: string): boolean {
  if (trackKind === "audio") return clipKind === "audio";
  if (clipKind === "audio") return false;
  return trackKind === "video" || trackKind === "overlay";
}

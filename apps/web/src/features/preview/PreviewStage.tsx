"use client";

import { useEffect, useRef, useState } from "react";
import { resolveScene } from "@opencut/render-engine";
import { MediaTextureCache } from "./MediaTextureCache";
import { PixiSceneRenderer } from "./PixiSceneRenderer";
import { probeWebGLSupport } from "./webglSupport";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { useEditorStore } from "@/state/editorStore";

interface PreviewStageProps {
  width: number;
  height: number;
}

/**
 * Mounts the PixiJS renderer and keeps it in step with the document.
 *
 * React owns a container <div>, and every Pixi Application gets its **own**
 * freshly-created <canvas> inside it — never a shared, React-owned one. This is
 * deliberate: Pixi's init is async, and React StrictMode (and HMR) mount the
 * effect twice with cleanup in between. If two Applications ever shared one
 * canvas, tearing down the first would release that canvas's WebGL context and
 * kill the second — surfacing as "could not initialise shader" / "context
 * lost", with a video clip widening the race because its texture init waits on
 * `onloadeddata`. Isolating a canvas per Application makes teardown harmless.
 */
export function PreviewStage({ width, height }: PreviewStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiSceneRenderer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  /**
   * Probed once, lazily. Doing it in the init effect would mean a synchronous
   * setState during an effect body, cascading an extra render. Safe as a state
   * initializer because the parent only mounts this after measuring a non-zero
   * size, so it never runs during server rendering.
   */
  const [webglSupport] = useState(probeWebGLSupport);
  /** Bumped when an async texture finishes, to force a redraw. */
  const [textureEpoch, setTextureEpoch] = useState(0);
  /** Bumped when a lost WebGL context is restored, to rebuild the renderer. */
  const [contextEpoch, setContextEpoch] = useState(0);

  const { store } = useMediaImportContext();

  const project = useEditorStore((state) => state.project);
  const playhead = useEditorStore((state) => state.playhead);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!webglSupport.supported) return;

    // A canvas owned by this Application alone. It is added to the container now
    // and removed on teardown, so no other instance ever touches its context.
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 h-full w-full";
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    container.appendChild(canvas);

    /**
     * WebGL contexts can be taken away at any time — a GPU driver reset, too
     * many live contexts, or an OS power event. The browser will not recover on
     * its own and a lost context renders as an unexplained blank frame, so it is
     * detected explicitly and rebuilt when the browser offers it back. Listeners
     * live on *this* canvas so they die with it.
     */
    const handleLost = (event: Event) => {
      // Without preventDefault the browser never fires a restore event.
      event.preventDefault();
      setInitError("Graphics context was lost");
      setIsReady(false);
    };
    const handleRestored = () => {
      setInitError(null);
      setContextEpoch((value) => value + 1);
    };
    canvas.addEventListener("webglcontextlost", handleLost);
    canvas.addEventListener("webglcontextrestored", handleRestored);

    const cache = new MediaTextureCache(store());
    const renderer = new PixiSceneRenderer(cache);
    let disposed = false;

    // Pixi's init is async but React cleanup is synchronous. Hold the promise
    // and dispose only after it settles, so a StrictMode double-mount tears down
    // in the right order instead of leaving a half-built Application.
    const ready = renderer
      .init(canvas, width, height)
      .then(() => {
        if (disposed) return;
        renderer.setTextureReadyCallback(() => setTextureEpoch((value) => value + 1));
        rendererRef.current = renderer;
        setInitError(null);
        setIsReady(true);
      })
      .catch((error: unknown) => {
        // Surfaced rather than swallowed: a silent failure here is an
        // unexplained black rectangle where the user's video should be.
        setInitError(error instanceof Error ? error.message : "Renderer failed to start");
      });

    return () => {
      disposed = true;
      setIsReady(false);
      rendererRef.current = null;
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);

      void ready.then(() => {
        renderer.destroy();
        cache.destroy();
        canvas.remove();
      });
    };
    // Mount-only by design (plus context rebuild): resizing is handled below
    // rather than by recreating the context, which would drop uploaded textures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, contextEpoch, webglSupport]);

  useEffect(() => {
    if (!isReady) return;
    rendererRef.current?.resize(width, height);
  }, [isReady, width, height]);

  useEffect(() => {
    if (!isReady || width === 0) return;

    // The one line that makes preview and export structurally identical: both
    // draw whatever `resolveScene` returns for this frame.
    const scene = resolveScene(project, playhead);
    rendererRef.current?.render(scene, project.entities.media, width, isPlaying);
  }, [isReady, project, playhead, isPlaying, width, height, textureEpoch]);

  // Context loss (runtime) takes precedence over an unsupported probe result.
  const displayError = initError ?? (webglSupport.supported ? null : webglSupport.reason);

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full">
      {displayError && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center">
          <p className="text-danger text-xs">Preview renderer unavailable: {displayError}</p>
        </div>
      )}
    </div>
  );
}

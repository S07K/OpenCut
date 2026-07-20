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
 * React owns the canvas element and nothing else. Pixi is imperative and
 * stateful, so it lives behind a ref and is driven by effects rather than by
 * rendering — trying to express a WebGL scene graph as JSX would mean rebuilding
 * display objects on every store change.
 */
export function PreviewStage({ width, height }: PreviewStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PixiSceneRenderer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  /** Bumped when an async texture finishes, to force a redraw. */
  const [textureEpoch, setTextureEpoch] = useState(0);
  /** Bumped when a lost WebGL context is restored, to rebuild the renderer. */
  const [contextEpoch, setContextEpoch] = useState(0);

  const { store } = useMediaImportContext();

  const project = useEditorStore((state) => state.project);
  const playhead = useEditorStore((state) => state.playhead);

  /**
   * WebGL contexts can be taken away at any time — a GPU driver reset, too many
   * live contexts on the page, or an OS power event. The browser will not
   * recover on its own, and a lost context renders as an unexplained blank
   * frame, so it is detected explicitly and rebuilt when the browser offers it
   * back.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleLost = (event: Event) => {
      // Without preventDefault the browser will never fire a restore event.
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

    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const support = probeWebGLSupport();
    if (!support.supported) {
      setInitError(support.reason);
      return;
    }

    const cache = new MediaTextureCache(store());
    const renderer = new PixiSceneRenderer(cache);
    let disposed = false;

    /**
     * Pixi's init is async but React's cleanup is synchronous, and in
     * StrictMode the effect is deliberately mounted twice. Tearing down while
     * init is still in flight leaves a half-built Application holding a WebGL
     * context, and the next instance then fails to compile its shaders.
     *
     * Holding the init promise and disposing only after it settles makes the
     * teardown ordering correct in both StrictMode and production.
     */
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

      void ready.then(() => {
        renderer.destroy();
        cache.destroy();
      });
    };
    // Mount-only by design: resizing is handled below rather than by rebuilding
    // the WebGL context, which would drop every uploaded texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, contextEpoch]);

  useEffect(() => {
    if (!isReady) return;
    rendererRef.current?.resize(width, height);
  }, [isReady, width, height]);

  useEffect(() => {
    if (!isReady || width === 0) return;

    // The one line that makes preview and export structurally identical: both
    // draw whatever `resolveScene` returns for this frame.
    const scene = resolveScene(project, playhead);
    rendererRef.current?.render(scene, project.entities.media, width);
  }, [isReady, project, playhead, width, height, textureEpoch]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ width, height, visibility: initError ? "hidden" : "visible" }}
      />
      {initError && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center">
          <p className="text-xs text-danger">
            Preview renderer unavailable: {initError}
          </p>
        </div>
      )}
    </>
  );
}

"use client";

import type { FrameSource } from "@cutaway/export-engine";
import type { MediaBlobStore } from "@cutaway/media-engine";
import { planVideoDecodeSchedule, resolveScene, type Scene } from "@cutaway/render-engine";
import type { ProjectDocument, Size } from "@cutaway/types";
import { MediaTextureCache } from "@/features/preview/MediaTextureCache";
import { PixiSceneRenderer } from "@/features/preview/PixiSceneRenderer";
import { ExactVideoDecoders } from "./ExactVideoDecoders";

/**
 * A FrameSource that renders export frames with the *same* compositor the
 * preview uses.
 *
 * This is what makes the exported file match the preview rather than merely
 * resemble it: both consume `resolveScene`, and both draw through
 * `PixiSceneRenderer`. The only differences are headless ones — the canvas is
 * the full project resolution (pixel ratio 1, no display scaling) and each
 * frame is fully prepared *before* it is captured, because an export must never
 * race a texture decode the way a realtime preview tolerates.
 *
 * Video is decoded frame-exactly with WebCodecs (see {@link ExactVideoDecoders})
 * rather than by seeking a `<video>` element, so the frame encoded at each
 * timeline position is precisely the frame the timeline asked for. Media the
 * decoder can't open falls back to element seeking, which is approximate but
 * keeps the export working.
 */
export class PixiExportFrameSource implements FrameSource<VideoFrame> {
  private constructor(
    private readonly project: ProjectDocument,
    private readonly renderer: PixiSceneRenderer,
    private readonly cache: MediaTextureCache,
    private readonly resolution: Size,
    private readonly frameRate: number,
    private readonly decoders: ExactVideoDecoders,
  ) {}

  static async create(
    project: ProjectDocument,
    store: MediaBlobStore,
    cache: MediaTextureCache,
    resolution: Size,
    frameRate: number,
    startFrame: number,
    endFrame: number,
  ): Promise<PixiExportFrameSource> {
    const canvas = document.createElement("canvas");
    canvas.width = resolution.width;
    canvas.height = resolution.height;

    const renderer = new PixiSceneRenderer(cache);
    // Pixel ratio 1: the backing store is exactly the requested output size.
    await renderer.init(canvas, resolution.width, resolution.height, 1);

    // Every timestamp the export will need, planned before decoding starts —
    // the decoders require the whole ordered list to walk each stream once.
    const schedule = planVideoDecodeSchedule(project, startFrame, endFrame);
    const decoders = await ExactVideoDecoders.create(project, store, schedule);

    // Give each exactly-decoded video a canvas-backed texture, so the renderer's
    // ordinary `cache.peek` lookup finds decoded frames without knowing it.
    for (const mediaId of schedule.keys()) {
      if (!decoders.has(mediaId)) continue;
      const dimensions = project.entities.media[mediaId]?.metadata.dimensions;
      cache.registerDecodedVideo(
        mediaId,
        dimensions?.width ?? resolution.width,
        dimensions?.height ?? resolution.height,
      );
    }

    return new PixiExportFrameSource(project, renderer, cache, resolution, frameRate, decoders);
  }

  async renderFrame(frame: number): Promise<VideoFrame> {
    const scene = resolveScene(this.project, frame);
    await this.prepareMedia(scene);

    // displayWidth === project width ⇒ scale 1, i.e. a full-resolution draw.
    this.renderer.render(scene, this.project.entities.media, this.resolution.width, false);

    const timestamp = Math.round((frame * 1_000_000) / this.frameRate);
    const duration = Math.round(1_000_000 / this.frameRate);
    return this.renderer.captureFrame(timestamp, duration);
  }

  async dispose(): Promise<void> {
    await this.decoders.dispose();
    this.renderer.destroy();
  }

  /**
   * Ensures every media node in the scene is ready to draw: textures decoded and
   * each video advanced to its exact source time. Unlike the preview, this
   * blocks until each frame's inputs are present, so no frame is captured with a
   * stale or missing texture.
   *
   * Nodes are prepared sequentially rather than in parallel: the decoders hand
   * back frames in the planned order, so two nodes racing for the same stream
   * could take each other's frame.
   */
  private async prepareMedia(scene: Scene): Promise<void> {
    for (const node of scene.nodes) {
      if (node.content.kind !== "media") continue;
      const { mediaId, mediaKind, sourceTimeSeconds } = node.content;

      if (mediaKind === "video" && this.decoders.has(mediaId)) {
        const decoded = await this.decoders.next(mediaId, Math.max(0, sourceTimeSeconds));
        // A null frame means the stream has nothing at this time (before its
        // first frame, or past its end); leave the last frame in place.
        if (decoded) this.cache.drawDecodedFrame(mediaId, decoded);
        continue;
      }

      const asset = this.project.entities.media[mediaId];
      if (!asset || asset.source.type !== "indexeddb") continue;

      await this.cache.load(mediaId, asset.source.key, mediaKind);
      if (mediaKind === "video") await this.seekVideo(mediaId, sourceTimeSeconds);
    }
  }

  /**
   * Fallback for media the WebCodecs decoder couldn't open: seeks a cached
   * video element to `seconds` and uploads that frame to its texture. Frame
   * accuracy is bounded by `<video>` seeking, so this is approximate — it exists
   * so an unusual container degrades in quality rather than failing the export.
   */
  private seekVideo(mediaId: string, seconds: number): Promise<void> {
    const element = this.cache.getVideoElement(mediaId);
    if (!element) return Promise.resolve();

    const target = Math.max(0, seconds);
    const alreadyThere = Math.abs(element.currentTime - target) < 1e-3 && element.readyState >= 2;

    return new Promise<void>((resolve) => {
      if (alreadyThere) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        element.removeEventListener("seeked", finish);
        resolve();
      };
      element.addEventListener("seeked", finish, { once: true });
      element.currentTime = target;
      // Safety net: never hang the whole export on a seek that never fires.
      setTimeout(finish, 1_000);
    }).then(() => {
      // With the preview ticker stopped, the video texture must be told to
      // upload the newly-seeked frame before it is drawn.
      const texture = this.cache.peek(mediaId);
      const source = texture?.source as { update?: () => void } | undefined;
      source?.update?.();
    });
  }
}

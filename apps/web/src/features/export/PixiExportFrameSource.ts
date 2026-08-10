"use client";

import type { FrameSource } from "@opencut/export-engine";
import { resolveScene, type Scene } from "@opencut/render-engine";
import type { ProjectDocument, Size } from "@opencut/types";
import { MediaTextureCache } from "@/features/preview/MediaTextureCache";
import { PixiSceneRenderer } from "@/features/preview/PixiSceneRenderer";

/**
 * A FrameSource that renders export frames with the *same* compositor the
 * preview uses.
 *
 * This is what makes the exported file match the preview rather than merely
 * resemble it: both consume `resolveScene`, and both draw through
 * `PixiSceneRenderer`. The only differences are headless ones — the canvas is
 * the full project resolution (pixel ratio 1, no display scaling) and each
 * frame is fully prepared *before* it is captured, because an export must never
 * race a texture decode or a video seek the way a realtime preview tolerates.
 */
export class PixiExportFrameSource implements FrameSource<VideoFrame> {
  private constructor(
    private readonly project: ProjectDocument,
    private readonly renderer: PixiSceneRenderer,
    private readonly cache: MediaTextureCache,
    private readonly resolution: Size,
    private readonly frameRate: number,
  ) {}

  static async create(
    project: ProjectDocument,
    cache: MediaTextureCache,
    resolution: Size,
    frameRate: number,
  ): Promise<PixiExportFrameSource> {
    const canvas = document.createElement("canvas");
    canvas.width = resolution.width;
    canvas.height = resolution.height;

    const renderer = new PixiSceneRenderer(cache);
    // Pixel ratio 1: the backing store is exactly the requested output size.
    await renderer.init(canvas, resolution.width, resolution.height, 1);

    return new PixiExportFrameSource(project, renderer, cache, resolution, frameRate);
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

  dispose(): void {
    this.renderer.destroy();
  }

  /**
   * Ensures every media node in the scene is ready to draw: textures decoded and
   * video elements seeked to the exact source time. Unlike the preview, this
   * blocks until each frame's inputs are present, so no frame is captured with a
   * stale or missing texture.
   */
  private async prepareMedia(scene: Scene): Promise<void> {
    await Promise.all(
      scene.nodes.map(async (node) => {
        if (node.content.kind !== "media") return;
        const asset = this.project.entities.media[node.content.mediaId];
        if (!asset || asset.source.type !== "indexeddb") return;

        await this.cache.load(node.content.mediaId, asset.source.key, node.content.mediaKind);

        if (node.content.mediaKind === "video") {
          await this.seekVideo(node.content.mediaId, node.content.sourceTimeSeconds);
        }
      }),
    );
  }

  /**
   * Seeks a cached video element to `seconds` and uploads that frame to its
   * texture. Frame accuracy is bounded by `<video>` seeking; a WebCodecs
   * `VideoDecoder` path for exact frames is a documented refinement.
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

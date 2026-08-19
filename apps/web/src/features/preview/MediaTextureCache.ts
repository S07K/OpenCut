"use client";

import { Texture } from "pixi.js";
import type { MediaBlobStore } from "@cutaway/media-engine";
import type { Id } from "@cutaway/types";

/**
 * Resolves media ids to Pixi textures, backed by the blob store.
 *
 * Caching is essential rather than an optimization: a clip appears on every
 * frame, and decoding its image or re-creating its video element sixty times a
 * second would make the preview unusable. Entries are keyed by media id and
 * live until explicitly released.
 */

interface VideoEntry {
  kind: "video";
  element: HTMLVideoElement;
  texture: Texture;
  objectUrl: string;
}

interface ImageEntry {
  kind: "image";
  texture: Texture;
  objectUrl: string;
}

/**
 * A video whose frames arrive from an external decoder instead of a `<video>`
 * element. Export uses this so it can draw exactly-decoded frames through the
 * same texture lookup the preview uses — the renderer never learns the
 * difference.
 */
interface CanvasVideoEntry {
  kind: "canvas-video";
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: Texture;
}

type CacheEntry = VideoEntry | ImageEntry | CanvasVideoEntry;

export class MediaTextureCache {
  private readonly entries = new Map<Id, CacheEntry>();
  /** Tracks in-flight loads so concurrent requests share one decode. */
  private readonly loading = new Map<Id, Promise<CacheEntry | null>>();

  constructor(private readonly store: MediaBlobStore) {}

  /** Returns a texture if already loaded. Never triggers a load. */
  peek(mediaId: Id): Texture | null {
    return this.entries.get(mediaId)?.texture ?? null;
  }

  getVideoElement(mediaId: Id): HTMLVideoElement | null {
    const entry = this.entries.get(mediaId);
    return entry?.kind === "video" ? entry.element : null;
  }

  /**
   * Registers a video whose frames come from a decoder rather than a `<video>`
   * element, and returns its texture. Subsequent `load` calls for this id are
   * no-ops, so no element is created for media the caller decodes itself.
   *
   * Call {@link drawDecodedFrame} to publish each new frame.
   */
  registerDecodedVideo(mediaId: Id, width: number, height: number): Texture | null {
    const existing = this.entries.get(mediaId);
    if (existing) return existing.texture;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    // `alpha` keeps transparent video transparent; without it the canvas would
    // composite every frame onto opaque black.
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return null;

    const texture = Texture.from(canvas);
    this.entries.set(mediaId, { kind: "canvas-video", canvas, context, texture });
    return texture;
  }

  /**
   * Publishes a decoded frame as the current contents of a registered video.
   *
   * The frame is copied into the entry's own canvas rather than swapped in, so
   * the texture identity stays stable across frames (Pixi would otherwise have
   * to rebuild the GPU resource) and the decoder stays free to recycle its
   * canvases. The texture is then marked dirty so the next draw re-uploads it.
   */
  drawDecodedFrame(mediaId: Id, frame: CanvasImageSource): void {
    const entry = this.entries.get(mediaId);
    if (entry?.kind !== "canvas-video") return;

    const { canvas, context, texture } = entry;
    // Clear first: a frame with transparency must not show the previous one
    // through its transparent regions.
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame, 0, 0, canvas.width, canvas.height);
    texture.source.update();
  }

  /**
   * Loads and caches a texture.
   *
   * Returns `null` when the media cannot be resolved — a missing asset must
   * degrade to an empty frame, never crash the render loop.
   */
  async load(
    mediaId: Id,
    blobKey: string,
    kind: "video" | "image" | "gif",
  ): Promise<Texture | null> {
    const cached = this.entries.get(mediaId);
    if (cached) return cached.texture;

    const inFlight = this.loading.get(mediaId);
    if (inFlight) return (await inFlight)?.texture ?? null;

    const promise = this.createEntry(mediaId, blobKey, kind);
    this.loading.set(mediaId, promise);

    try {
      const entry = await promise;
      if (entry) this.entries.set(mediaId, entry);
      return entry?.texture ?? null;
    } finally {
      this.loading.delete(mediaId);
    }
  }

  private async createEntry(
    mediaId: Id,
    blobKey: string,
    kind: "video" | "image" | "gif",
  ): Promise<CacheEntry | null> {
    const blob = await this.store.get(blobKey);
    if (!blob) return null;

    const objectUrl = URL.createObjectURL(blob);

    try {
      if (kind === "video") {
        const element = document.createElement("video");
        element.src = objectUrl;
        element.muted = true;
        element.playsInline = true;
        element.loop = false;
        element.preload = "auto";
        // Required before a frame exists to upload as a texture.
        await new Promise<void>((resolve, reject) => {
          element.onloadeddata = () => resolve();
          element.onerror = () => reject(new Error("Video failed to load"));
        });

        return { kind: "video", element, texture: Texture.from(element), objectUrl };
      }

      const image = new Image();
      image.src = objectUrl;
      await image.decode();

      return { kind: "image", texture: Texture.from(image), objectUrl };
    } catch {
      URL.revokeObjectURL(objectUrl);
      return null;
    }
  }

  /** Releases one entry's GPU and blob resources. */
  release(mediaId: Id): void {
    const entry = this.entries.get(mediaId);
    if (!entry) return;

    entry.texture.destroy(true);
    if (entry.kind === "video") {
      URL.revokeObjectURL(entry.objectUrl);
      entry.element.pause();
      entry.element.removeAttribute("src");
      entry.element.load();
    } else if (entry.kind === "image") {
      URL.revokeObjectURL(entry.objectUrl);
    }
    // A decoded-video entry owns only its canvas, which the texture just freed.

    this.entries.delete(mediaId);
  }

  destroy(): void {
    for (const mediaId of [...this.entries.keys()]) this.release(mediaId);
  }
}

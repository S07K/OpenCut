"use client";

import { Texture } from "pixi.js";
import type { MediaBlobStore } from "@opencut/media-engine";
import type { Id } from "@opencut/types";

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

type CacheEntry = VideoEntry | ImageEntry;

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
   * Loads and caches a texture.
   *
   * Returns `null` when the media cannot be resolved — a missing asset must
   * degrade to an empty frame, never crash the render loop.
   */
  async load(mediaId: Id, blobKey: string, kind: "video" | "image" | "gif"): Promise<Texture | null> {
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
    URL.revokeObjectURL(entry.objectUrl);
    if (entry.kind === "video") {
      entry.element.pause();
      entry.element.removeAttribute("src");
      entry.element.load();
    }

    this.entries.delete(mediaId);
  }

  destroy(): void {
    for (const mediaId of [...this.entries.keys()]) this.release(mediaId);
  }
}

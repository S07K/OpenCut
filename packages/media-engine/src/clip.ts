/**
 * Turning an imported asset into a timeline clip.
 *
 * Lives here rather than in the UI because "what kind of clip does this file
 * become" is a media-domain question, and the answer must be identical whether
 * the clip is created by drag-drop, by the command palette, or by a plugin.
 */

import type { Clip, ClipContent, Id, MediaAsset, Size } from "@opencut/types";
import { staticValue } from "@opencut/types";
import { createClip } from "@opencut/utils";
import { assetDurationInFrames } from "./import";

/** Builds the content payload matching an asset's kind. */
export function createContentForAsset(asset: MediaAsset): ClipContent {
  switch (asset.kind) {
    case "video":
      return {
        kind: "video",
        mediaId: asset.id,
        sourceInFrame: 0,
        speed: 1,
        volume: staticValue(1),
        muted: false,
      };

    case "audio":
      return {
        kind: "audio",
        mediaId: asset.id,
        sourceInFrame: 0,
        speed: 1,
        volume: staticValue(1),
        muted: false,
        fadeInFrames: 0,
        fadeOutFrames: 0,
      };

    case "gif":
      return { kind: "gif", mediaId: asset.id, loop: true };

    case "image":
    case "font":
    default:
      return { kind: "image", mediaId: asset.id };
  }
}

export interface CreateClipForAssetOptions {
  asset: MediaAsset;
  trackId: Id;
  startFrame: number;
  projectFrameRate: number;
  /** Project canvas size, used to scale the clip to fit on import. */
  projectResolution: Size;
}

/**
 * Scale that fits `source` inside `frame` without cropping, preserving aspect.
 *
 * Media is scaled to *contain* rather than cover, so nothing is silently cut
 * off on import — a creator who wants a full-bleed crop can scale up, but
 * losing the edges of a shot without being told is much worse.
 */
export function fitScale(source: Size, frame: Size): number {
  if (source.width <= 0 || source.height <= 0) return 1;
  return Math.min(frame.width / source.width, frame.height / source.height);
}

export function createClipForAsset(options: CreateClipForAssetOptions): Clip {
  const { asset, trackId, startFrame, projectFrameRate, projectResolution } = options;

  const clip = createClip({
    name: asset.name,
    trackId,
    startFrame,
    durationFrames: assetDurationInFrames(asset, projectFrameRate),
    content: createContentForAsset(asset),
  });

  const dimensions = asset.metadata.dimensions;
  if (!dimensions) return clip;

  // Baked into the document at creation rather than applied by the renderer.
  // The user sees the real number in the Transform panel and can change it;
  // a hidden auto-fit in the renderer would be unexplainable and un-editable.
  const scale = fitScale(dimensions, projectResolution);

  return {
    ...clip,
    transform: { ...clip.transform, scale: staticValue({ x: scale, y: scale }) },
  };
}

/** Track kinds that will accept a given media kind. */
export function trackKindForAsset(asset: MediaAsset): "audio" | "video" {
  return asset.kind === "audio" ? "audio" : "video";
}

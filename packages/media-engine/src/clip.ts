/**
 * Turning an imported asset into a timeline clip.
 *
 * Lives here rather than in the UI because "what kind of clip does this file
 * become" is a media-domain question, and the answer must be identical whether
 * the clip is created by drag-drop, by the command palette, or by a plugin.
 */

import type { Clip, ClipContent, Id, MediaAsset } from "@opencut/types";
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
}

export function createClipForAsset(options: CreateClipForAssetOptions): Clip {
  const { asset, trackId, startFrame, projectFrameRate } = options;

  return createClip({
    name: asset.name,
    trackId,
    startFrame,
    durationFrames: assetDurationInFrames(asset, projectFrameRate),
    content: createContentForAsset(asset),
  });
}

/** Track kinds that will accept a given media kind. */
export function trackKindForAsset(asset: MediaAsset): "audio" | "video" {
  return asset.kind === "audio" ? "audio" : "video";
}

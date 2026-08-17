/**
 * The import pipeline.
 *
 * ```
 * File → classify → persist bytes → probe metadata → thumbnail → waveform
 * ```
 *
 * Bytes are persisted **first**, before the slow analysis steps. If the tab
 * crashes mid-import the file is already safe and only its thumbnail is
 * missing; the reverse ordering would lose the media entirely.
 *
 * Thumbnail and waveform generation are deliberately *not* awaited by the
 * caller-visible result — see `importFile`.
 */

import type { MediaAsset, MediaKind } from "@cutaway/types";
import { createId } from "@cutaway/utils";
import { classifyFile } from "./mime";
import { generateThumbnail, probeMedia } from "./probe";
import type { MediaBlobStore } from "./storage";
import { extractWaveform, serializeWaveform } from "./waveform";

export class UnsupportedMediaError extends Error {
  constructor(public readonly fileName: string) {
    super(`Unsupported file type: ${fileName}`);
    this.name = "UnsupportedMediaError";
  }
}

export interface ImportContext {
  store: MediaBlobStore;
  /**
   * Called when a slow artifact finishes after the asset itself is ready, so
   * the UI can fill in a thumbnail or waveform in place.
   */
  onAssetUpdated?: (asset: MediaAsset) => void;
}

function blobKey(assetId: string, suffix: string): string {
  return `${assetId}:${suffix}`;
}

/**
 * Imports one file and returns its asset as soon as the bytes are stored and
 * metadata is read.
 *
 * Thumbnails and waveforms are generated *after* this resolves and reported via
 * `onAssetUpdated`. Decoding a long video's waveform takes seconds, and blocking
 * the import on it would leave the user staring at a spinner when the clip is
 * already usable.
 */
export async function importFile(file: File, context: ImportContext): Promise<MediaAsset> {
  const kind: MediaKind | null = classifyFile(file.name, file.type);
  if (!kind) throw new UnsupportedMediaError(file.name);

  const id = createId("media");
  const sourceKey = blobKey(id, "source");

  await context.store.put(sourceKey, file);
  const metadata = await probeMedia(file);

  const asset: MediaAsset = {
    id,
    name: file.name,
    kind,
    mimeType: file.type,
    source: { type: "indexeddb", key: sourceKey },
    metadata,
    thumbnailKey: null,
    waveformKey: null,
    importedAt: Date.now(),
  };

  void generateDerivedArtifacts(file, asset, context);

  return asset;
}

/**
 * Produces the thumbnail and waveform in the background.
 *
 * Failures here are swallowed on purpose: a missing thumbnail degrades the
 * library to an icon, which is a cosmetic problem. It must never take down an
 * import whose bytes are already safely stored.
 */
async function generateDerivedArtifacts(
  file: File,
  asset: MediaAsset,
  context: ImportContext,
): Promise<void> {
  let current = asset;

  try {
    const thumbnail = await generateThumbnail(file);
    if (thumbnail) {
      const key = blobKey(asset.id, "thumb");
      await context.store.put(key, thumbnail);
      current = { ...current, thumbnailKey: key };
      context.onAssetUpdated?.(current);
    }
  } catch {
    // Cosmetic only.
  }

  if (asset.kind === "video" || asset.kind === "audio") {
    try {
      const peaks = await extractWaveform(file);
      if (peaks) {
        const key = blobKey(asset.id, "waveform");
        const payload = new Blob([JSON.stringify(serializeWaveform(peaks))], {
          type: "application/json",
        });
        await context.store.put(key, payload);
        current = { ...current, waveformKey: key };
        context.onAssetUpdated?.(current);
      }
    } catch {
      // Cosmetic only.
    }
  }
}

export interface ImportResult {
  assets: MediaAsset[];
  errors: { fileName: string; message: string }[];
}

/**
 * Imports many files, isolating failures.
 *
 * One unsupported file in a multi-select must not discard the other nineteen,
 * so every file is settled independently and problems are reported alongside
 * the successes rather than thrown.
 */
export async function importFiles(
  files: readonly File[],
  context: ImportContext,
): Promise<ImportResult> {
  const settled = await Promise.allSettled(files.map((file) => importFile(file, context)));

  const assets: MediaAsset[] = [];
  const errors: ImportResult["errors"] = [];

  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      assets.push(outcome.value);
      return;
    }

    const reason: unknown = outcome.reason;
    errors.push({
      fileName: files[index]?.name ?? "Unknown file",
      message: reason instanceof Error ? reason.message : "Import failed",
    });
  });

  return { assets, errors };
}

/**
 * Duration of an imported asset in project frames.
 *
 * Still images have no intrinsic duration, so they get a sensible default
 * rather than zero — a zero-length clip cannot be seen or grabbed.
 */
export const DEFAULT_STILL_DURATION_SECONDS = 5;

export function assetDurationInFrames(asset: MediaAsset, projectFrameRate: number): number {
  const seconds =
    asset.metadata.durationSeconds > 0
      ? asset.metadata.durationSeconds
      : DEFAULT_STILL_DURATION_SECONDS;

  return Math.max(1, Math.round(seconds * projectFrameRate));
}

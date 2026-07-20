"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createMediaStore, importFiles, type MediaBlobStore } from "@opencut/media-engine";
import { useEditorStore } from "@/state/editorStore";

/**
 * Import orchestration for the UI layer.
 *
 * The blob store is created lazily and held in a ref rather than at module
 * scope: `createMediaStore` touches `indexedDB`, which does not exist during
 * server rendering.
 */

export interface ImportError {
  fileName: string;
  message: string;
}

export interface MediaImportApi {
  importFromFiles: (files: FileList | File[]) => Promise<void>;
  isImporting: boolean;
  /** Names of files currently being processed, for progress display. */
  pending: string[];
  errors: ImportError[];
  dismissErrors: () => void;
  store: () => MediaBlobStore;
  /** Removes an asset from the project *and* deletes its stored bytes. */
  removeAsset: (assetId: string) => Promise<void>;
}

export function useMediaImport(): MediaImportApi {
  const storeRef = useRef<MediaBlobStore | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);

  const addMediaAssets = useEditorStore((state) => state.addMediaAssets);
  const upsertMediaAsset = useEditorStore((state) => state.upsertMediaAsset);
  const removeMediaAsset = useEditorStore((state) => state.removeMediaAsset);

  const getStore = useCallback((): MediaBlobStore => {
    storeRef.current ??= createMediaStore();
    return storeRef.current;
  }, []);

  const importFromFiles = useCallback(
    async (input: FileList | File[]) => {
      const files = Array.from(input);
      if (files.length === 0) return;

      setPending((current) => [...current, ...files.map((file) => file.name)]);
      setErrors([]);

      try {
        const result = await importFiles(files, {
          store: getStore(),
          // Thumbnails and waveforms land after the asset is already in the
          // library, so the grid fills in progressively instead of blocking.
          onAssetUpdated: upsertMediaAsset,
        });

        if (result.assets.length > 0) addMediaAssets(result.assets);
        if (result.errors.length > 0) setErrors(result.errors);
      } finally {
        const names = new Set(files.map((file) => file.name));
        setPending((current) => current.filter((name) => !names.has(name)));
      }
    },
    [getStore, addMediaAssets, upsertMediaAsset],
  );

  const removeAsset = useCallback(
    async (assetId: string) => {
      const asset = useEditorStore.getState().project.entities.media[assetId];

      // Drop it from the document first so the UI responds immediately; the
      // blob cleanup that follows is invisible to the user.
      removeMediaAsset(assetId);
      if (!asset) return;

      const keys = [
        asset.source.type === "indexeddb" ? asset.source.key : null,
        asset.thumbnailKey,
        asset.waveformKey,
      ].filter((key): key is string => Boolean(key));

      // Without this the bytes outlive the asset forever — a 2GB video removed
      // from the library would keep occupying the user's disk quota with
      // nothing in the app referencing it.
      await Promise.allSettled(keys.map((key) => getStore().delete(key)));
    },
    [removeMediaAsset, getStore],
  );

  return useMemo(
    () => ({
      importFromFiles,
      isImporting: pending.length > 0,
      pending,
      errors,
      dismissErrors: () => setErrors([]),
      store: getStore,
      removeAsset,
    }),
    [importFromFiles, pending, errors, getStore, removeAsset],
  );
}

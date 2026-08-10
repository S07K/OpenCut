"use client";

import { useCallback, useRef, useState } from "react";
import type { ExportProgress } from "@opencut/export-engine";
import { ExportCancelledError } from "@opencut/export-engine";
import type { ExportSettings } from "@opencut/types";
import { useEditorStore } from "@/state/editorStore";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { exportProjectToBlob } from "./exportProject";

export interface ExportController {
  isExporting: boolean;
  progress: ExportProgress | null;
  error: string | null;
  /** Whether the last export finished and downloaded successfully. */
  done: boolean;
  /** Starts an export, optionally overriding the project's stored settings. */
  start: (settings?: ExportSettings) => void;
  cancel: () => void;
}

/**
 * Drives a project export and the browser download of its result.
 *
 * State lives here rather than in a global store because an export is a
 * transient, view-local activity — start it, watch progress, get a file. The
 * abort controller lets the UI cancel a long render; the download is triggered
 * from the resulting Blob, which keeps the whole thing local (no upload).
 */
export function useExport(): ExportController {
  const { store } = useMediaImportContext();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    (settings?: ExportSettings) => {
      if (abortRef.current) return; // already running
      const controller = new AbortController();
      abortRef.current = controller;
      setIsExporting(true);
      setError(null);
      setProgress(null);
      setDone(false);

      void (async () => {
        try {
          const project = useEditorStore.getState().project;
          const { blob, filename } = await exportProjectToBlob(project, store(), {
            signal: controller.signal,
            onProgress: setProgress,
            settings,
          });
          triggerDownload(blob, filename);
          setDone(true);
        } catch (err) {
          if (!(err instanceof ExportCancelledError)) {
            setError(err instanceof Error ? err.message : String(err));
          }
        } finally {
          abortRef.current = null;
          setIsExporting(false);
        }
      })();
    },
    [store],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { isExporting, progress, error, done, start, cancel };
}

/** Saves a Blob to disk via a transient object URL. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

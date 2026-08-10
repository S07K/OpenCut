"use client";

import type { MediaBlobStore } from "@opencut/media-engine";
import { planExport, runVideoExport, type ExportProgress } from "@opencut/export-engine";
import type { ProjectDocument } from "@opencut/types";
import { MediaTextureCache } from "@/features/preview/MediaTextureCache";
import { isExportSupported } from "./capabilities";
import { PixiExportFrameSource } from "./PixiExportFrameSource";
import { WebCodecsVideoWriter } from "./WebCodecsVideoWriter";

export interface ExportResult {
  blob: Blob;
  filename: string;
}

export interface ExportProjectOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

const MIME_BY_FORMAT: Partial<Record<ProjectDocument["exportSettings"]["format"], string>> = {
  mp4: "video/mp4",
  webm: "video/webm",
};

/**
 * Renders and encodes a project to a video Blob using the project's own export
 * settings.
 *
 * This is the top of the browser export stack: it assembles the pure engine
 * plan, the Pixi frame source, and the WebCodecs writer, then hands them to the
 * engine's orchestrator. Everything hard — the loop, timing, progress, cancel —
 * lives in the engine; this function just wires the browser pieces together.
 */
export async function exportProjectToBlob(
  project: ProjectDocument,
  store: MediaBlobStore,
  options: ExportProjectOptions = {},
): Promise<ExportResult> {
  if (!isExportSupported()) {
    throw new Error(
      "This browser can't export video — it lacks the WebCodecs API. Try a recent Chrome or Edge.",
    );
  }

  const settings = project.exportSettings;
  const plan = planExport(project, settings);

  const cache = new MediaTextureCache(store);
  const frameSource = await PixiExportFrameSource.create(
    project,
    cache,
    plan.resolution,
    plan.frameRate,
  );
  const videoWriter = await WebCodecsVideoWriter.create(plan);

  const bytes = await runVideoExport({
    plan,
    frameSource,
    videoWriter,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  const mime = MIME_BY_FORMAT[plan.format] ?? "application/octet-stream";
  const blob = new Blob([bytes as BlobPart], { type: mime });
  return { blob, filename: `${sanitize(project.name)}.${plan.format}` };
}

/** Makes a project name safe to use as a download filename. */
function sanitize(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "export";
}

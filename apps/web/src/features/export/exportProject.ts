"use client";

import type { MediaBlobStore } from "@opencut/media-engine";
import {
  ExportCancelledError,
  planExport,
  runVideoExport,
  type ExportProgress,
} from "@opencut/export-engine";
import type { ExportSettings, ProjectDocument } from "@opencut/types";
import { MediaTextureCache } from "@/features/preview/MediaTextureCache";
import { isExportSupported, resolveAudioConfig, resolveVideoConfig } from "./capabilities";
import { MediaContainer } from "./MediaContainer";
import { PixiExportFrameSource } from "./PixiExportFrameSource";
import { WebCodecsVideoWriter } from "./WebCodecsVideoWriter";
import { mixProjectAudio } from "./mixAudio";
import { encodeAudioBuffer } from "./encodeAudio";

export interface ExportResult {
  blob: Blob;
  filename: string;
}

export interface ExportProjectOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  /** Overrides the project's stored export settings for this run. */
  settings?: ExportSettings;
}

const MIME_BY_FORMAT: Partial<Record<ProjectDocument["exportSettings"]["format"], string>> = {
  mp4: "video/mp4",
  webm: "video/webm",
};

/**
 * Renders and encodes a project to a video Blob using the project's own export
 * settings.
 *
 * The order is deliberate: audio is mixed and encoded into the shared container
 * *first* (it's cheap and one-shot), then the video loop runs through the
 * engine's orchestrator, whose final step finalises the container with both
 * tracks in place. Everything hard — the frame loop, timing, progress, cancel —
 * lives in the engine; this function wires the browser pieces together and
 * degrades to video-only when there's no audio or the browser can't encode it.
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

  const settings = options.settings ?? project.exportSettings;
  const plan = planExport(project, settings);
  const throwIfCancelled = () => {
    if (options.signal?.aborted) throw new ExportCancelledError();
  };

  const videoConfig = await resolveVideoConfig(plan);

  // Mix + resolve the audio track up front; either step may legitimately yield
  // nothing (no audio clips, audio disabled, or unsupported), in which case the
  // export is video-only.
  const mixed = plan.audioCodec === "none" ? null : await mixProjectAudio(project, store, plan);
  throwIfCancelled();
  const audioConfig = mixed
    ? await resolveAudioConfig(plan, mixed.numberOfChannels, mixed.sampleRate)
    : null;

  const container = MediaContainer.create(plan, videoConfig, audioConfig);
  if (mixed && audioConfig) {
    await encodeAudioBuffer(mixed, audioConfig, container);
  }
  throwIfCancelled();

  const cache = new MediaTextureCache(store);
  const frameSource = await PixiExportFrameSource.create(
    project,
    cache,
    plan.resolution,
    plan.frameRate,
  );
  const videoWriter = WebCodecsVideoWriter.create(plan, container, videoConfig);

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

/**
 * Media probing and thumbnail generation.
 *
 * This is the browser-facing edge of the media pipeline: it drives `<video>`,
 * `<img>`, and canvas to learn what a file contains. Everything here is
 * best-effort and must degrade gracefully — a file that cannot be probed should
 * still import with partial metadata rather than being rejected.
 */

import type { MediaKind, MediaMetadata } from "@opencut/types";
import { classifyFile } from "./mime";

/** Loads an object URL, runs `use`, and always revokes the URL afterwards. */
async function withObjectURL<T>(blob: Blob, use: (url: string) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(blob);
  try {
    return await use(url);
  } finally {
    // Object URLs pin their blob in memory until revoked. Skipping this leaks
    // the full file — catastrophic when the files are gigabyte videos.
    URL.revokeObjectURL(url);
  }
}

/** Rejects if an element never fires its ready event. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

const PROBE_TIMEOUT_MS = 15_000;

function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return withTimeout(
    new Promise<HTMLVideoElement>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => resolve(video);
      video.onerror = () => reject(new Error("Video metadata could not be read"));
      video.src = url;
    }),
    PROBE_TIMEOUT_MS,
    "Timed out reading video metadata",
  );
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return withTimeout(
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image could not be decoded"));
      image.src = url;
    }),
    PROBE_TIMEOUT_MS,
    "Timed out decoding image",
  );
}

function emptyMetadata(byteSize: number): MediaMetadata {
  return {
    durationSeconds: 0,
    frameRate: null,
    dimensions: null,
    hasAudio: false,
    hasVideo: false,
    codec: null,
    sampleRate: null,
    channels: null,
    byteSize,
  };
}

/**
 * Detects whether a loaded video element carries an audio track.
 *
 * There is no standard API for this, so we use the vendor-prefixed properties
 * that exist. When none are present we assume audio *is* there: importing a
 * clip whose audio we wrongly hid is far worse than showing an empty waveform.
 */
function detectAudioTrack(video: HTMLVideoElement): boolean {
  const candidate = video as HTMLVideoElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
  };

  if (typeof candidate.mozHasAudio === "boolean") return candidate.mozHasAudio;
  if (candidate.audioTracks) return candidate.audioTracks.length > 0;
  if (typeof candidate.webkitAudioDecodedByteCount === "number") {
    return candidate.webkitAudioDecodedByteCount > 0;
  }
  return true;
}

/**
 * Reads what the browser can tell us about a media file.
 *
 * Note that `frameRate` comes back `null` for video: no browser API exposes a
 * source file's true frame rate. The project frame rate governs the timeline
 * regardless, so this only matters for frame-exact source seeking — which is
 * WebCodecs' job in the export phase, and it can report the real value then.
 */
export async function probeMedia(file: File): Promise<MediaMetadata> {
  const kind = classifyFile(file.name, file.type);
  const base = emptyMetadata(file.size);

  try {
    switch (kind) {
      case "video":
        return await withObjectURL(file, async (url) => {
          const video = await loadVideoElement(url);
          return {
            ...base,
            durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
            dimensions: { width: video.videoWidth, height: video.videoHeight },
            hasVideo: video.videoWidth > 0,
            hasAudio: detectAudioTrack(video),
          };
        });

      case "audio":
        return await withObjectURL(file, async (url) => {
          const audio = await loadVideoElement(url);
          return {
            ...base,
            durationSeconds: Number.isFinite(audio.duration) ? audio.duration : 0,
            hasAudio: true,
          };
        });

      case "image":
      case "gif":
        return await withObjectURL(file, async (url) => {
          const image = await loadImageElement(url);
          return {
            ...base,
            dimensions: { width: image.naturalWidth, height: image.naturalHeight },
            hasVideo: true,
          };
        });

      default:
        return base;
    }
  } catch {
    // Probing is best-effort: an unreadable file still imports, just without
    // dimensions or duration, and the user can see and remove it.
    return base;
  }
}

export const THUMBNAIL_MAX_EDGE = 320;

function fitWithin(width: number, height: number, maxEdge: number) {
  if (width === 0 || height === 0) return { width: maxEdge, height: maxEdge };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function drawToBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
}

/** Seeks a video element and resolves once the new frame is actually painted. */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Seek failed"));
      video.currentTime = time;
    }),
    PROBE_TIMEOUT_MS,
    "Timed out seeking video",
  );
}

/**
 * Renders a thumbnail for the media library.
 *
 * Video thumbnails are taken a little way in rather than at frame 0, because a
 * great many videos open on black or on a fade-in — a library full of black
 * rectangles is useless for finding footage.
 */
export async function generateThumbnail(file: File): Promise<Blob | null> {
  const kind: MediaKind | null = classifyFile(file.name, file.type);

  try {
    if (kind === "video") {
      return await withObjectURL(file, async (url) => {
        const video = await loadVideoElement(url);
        const target = Number.isFinite(video.duration)
          ? Math.min(video.duration * 0.1, 2)
          : 0;
        await seekTo(video, target);

        const size = fitWithin(video.videoWidth, video.videoHeight, THUMBNAIL_MAX_EDGE);
        return await drawToBlob(video, size.width, size.height);
      });
    }

    if (kind === "image" || kind === "gif") {
      return await withObjectURL(file, async (url) => {
        const image = await loadImageElement(url);
        const size = fitWithin(image.naturalWidth, image.naturalHeight, THUMBNAIL_MAX_EDGE);
        return await drawToBlob(image, size.width, size.height);
      });
    }

    // Audio and fonts get no thumbnail; the library renders an icon instead.
    return null;
  } catch {
    return null;
  }
}

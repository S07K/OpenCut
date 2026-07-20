/**
 * MIME and file-kind classification.
 *
 * Pure and dependency-free, so the rules that decide what an imported file *is*
 * can be tested exhaustively without touching a browser. Getting this wrong is
 * quietly destructive — a video misclassified as an image imports with no audio
 * and no duration, and the user has no idea why.
 */

import type { MediaKind } from "@opencut/types";

/** Extensions we accept when the browser reports no MIME type at all. */
const EXTENSION_KINDS: Record<string, MediaKind> = {
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  flac: "audio",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  bmp: "image",
  gif: "gif",
  ttf: "font",
  otf: "font",
  woff: "font",
  woff2: "font",
};

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index + 1).toLowerCase();
}

/**
 * Classifies a file by MIME type, falling back to its extension.
 *
 * MIME is checked first because it is what the browser will actually honour
 * when decoding. The extension fallback exists because drag-and-drop from some
 * file managers, and `.mkv` in most browsers, yield an empty `type`.
 *
 * Returns `null` for anything unrecognized — importing an unknown file is
 * refused loudly rather than guessed at.
 */
export function classifyFile(fileName: string, mimeType: string): MediaKind | null {
  const mime = mimeType.toLowerCase();

  // GIF is checked before the generic image branch: it is animated, needs frame
  // extraction, and behaves like video on the timeline.
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("font/") || mime === "application/font-woff") return "font";

  return EXTENSION_KINDS[extensionOf(fileName)] ?? null;
}

/** Human-readable byte size, for the media library. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

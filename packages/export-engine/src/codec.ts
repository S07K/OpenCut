/**
 * Mapping export settings to codec strings — pure, no capability probing.
 *
 * Returns the WebCodecs codec identifier the encoder should be *asked* for; the
 * adapter is responsible for calling `isConfigSupported` and degrading. Kept
 * here, away from browser globals, so the mapping (including the H.264 level
 * picked from resolution) is testable on its own.
 */

import type { ExportSettings, Size } from "@opencut/types";

/**
 * The WebCodecs codec string for a video codec at a given resolution.
 *
 * For H.264 the AVC level is chosen from the frame size so the encoder is not
 * asked for a level too low to hold the resolution (which fails on strict
 * implementations). Levels: 3.1 up to 720p, 4.0 up to 1080p, 5.1 above.
 */
export function videoCodecString(
  codec: ExportSettings["videoCodec"],
  resolution: Size,
): string | null {
  switch (codec) {
    case "h264":
      return `avc1.4200${avcLevelHex(resolution)}`;
    case "h265":
      // Main profile, level derived by the encoder; a reasonable default string.
      return "hev1.1.6.L93.B0";
    case "vp9":
      return "vp09.00.10.08";
    case "av1":
      return "av01.0.04M.08";
    case "none":
      return null;
  }
}

/** The WebCodecs codec string for an audio codec. */
export function audioCodecString(codec: ExportSettings["audioCodec"]): string | null {
  switch (codec) {
    case "aac":
      return "mp4a.40.2"; // AAC-LC
    case "opus":
      return "opus";
    case "mp3":
      return "mp3";
    case "none":
      return null;
  }
}

/** AVC level byte (hex) sized to the resolution. */
function avcLevelHex(resolution: Size): string {
  const pixels = resolution.width * resolution.height;
  if (pixels <= 1280 * 720) return "1f"; // level 3.1
  if (pixels <= 1920 * 1080) return "28"; // level 4.0
  return "33"; // level 5.1
}

"use client";

import type { ExportPlan } from "@opencut/export-engine";
import { videoCodecString } from "@opencut/export-engine";
import type { ExportSettings } from "@opencut/types";

/**
 * Browser support probing and container/codec reconciliation for export.
 *
 * This is the adapter-side counterpart to the engine's pure `videoCodecString`:
 * the engine says which codec string to *ask* for, and this file asks the
 * browser whether it can actually deliver it — falling back within the chosen
 * container when it can't. Keeping the probe here, behind `VideoEncoder`, is why
 * the engine stays DOM-free and Node-testable.
 */

/** True when the browser exposes the WebCodecs pieces export depends on. */
export function isExportSupported(): boolean {
  return (
    typeof globalThis.VideoEncoder !== "undefined" && typeof globalThis.VideoFrame !== "undefined"
  );
}

/** The muxer's codec label for a container + codec pairing. */
export type MuxerVideoCodec = "avc" | "hevc" | "vp9" | "av1" | "V_VP8" | "V_VP9" | "V_AV1";

export interface ResolvedVideoConfig {
  encoderConfig: VideoEncoderConfig;
  muxerCodec: MuxerVideoCodec;
  /** The document-level codec that was actually selected (may differ on fallback). */
  codec: ExportSettings["videoCodec"];
}

/**
 * Finds a VideoEncoder config the browser supports for the plan's container,
 * preferring the requested codec and falling back to others valid in that
 * container. Throws when nothing is supported.
 */
export async function resolveVideoConfig(plan: ExportPlan): Promise<ResolvedVideoConfig> {
  const candidates = containerCandidates(plan.format, plan.videoCodec);
  const { width, height } = plan.resolution;

  for (const codec of candidates) {
    const codecString = videoCodecString(codec, plan.resolution);
    if (!codecString) continue;

    const encoderConfig: VideoEncoderConfig = {
      codec: codecString,
      width,
      height,
      bitrate: plan.videoBitrate,
      framerate: plan.frameRate,
      // mp4 needs length-prefixed NAL units (avcC/hvcC), not Annex-B, so the
      // muxer can build the sample description.
      ...(codec === "h264" ? { avc: { format: "avc" as const } } : {}),
      ...(codec === "h265" ? { hevc: { format: "hevc" as const } } : {}),
    };

    const support = await VideoEncoder.isConfigSupported(encoderConfig);
    if (support.supported && support.config) {
      return { encoderConfig: support.config, muxerCodec: muxerCodec(plan.format, codec), codec };
    }
  }

  throw new Error(
    `This browser can't encode ${plan.format.toUpperCase()} video. Try a different format.`,
  );
}

/** Codecs to try for a container, requested one first. */
function containerCandidates(
  format: ExportPlan["format"],
  requested: ExportSettings["videoCodec"],
): ExportSettings["videoCodec"][] {
  const webm: ExportSettings["videoCodec"][] = ["vp9", "av1"];
  const mp4: ExportSettings["videoCodec"][] = ["h264", "av1", "vp9", "h265"];
  const valid = format === "webm" ? webm : mp4;
  // Put the requested codec first if the container can hold it.
  return valid.includes(requested) ? [requested, ...valid.filter((c) => c !== requested)] : valid;
}

function muxerCodec(
  format: ExportPlan["format"],
  codec: ExportSettings["videoCodec"],
): MuxerVideoCodec {
  if (format === "webm") {
    return codec === "av1" ? "V_AV1" : "V_VP9";
  }
  switch (codec) {
    case "h264":
      return "avc";
    case "h265":
      return "hevc";
    case "vp9":
      return "vp9";
    case "av1":
      return "av1";
    default:
      return "avc";
  }
}

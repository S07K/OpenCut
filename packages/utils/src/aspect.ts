/**
 * Aspect-ratio presets.
 *
 * One-click switching between the ratios creators actually publish to. Changing
 * ratio recomputes the project resolution while holding the *longer edge* near a
 * standard size, so switching 16:9 → 9:16 gives a real 1080×1920 rather than a
 * squashed frame. Pure — the store applies the result.
 */

import type { AspectRatioPreset, Size } from "@opencut/types";

export interface AspectRatioOption {
  id: Exclude<AspectRatioPreset, "custom">;
  label: string;
  ratio: number;
}

export const ASPECT_RATIOS: AspectRatioOption[] = [
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "21:9", label: "21:9", ratio: 21 / 9 },
];

/** Target for the longer edge, so every ratio lands on a familiar resolution. */
const REFERENCE_LONG_EDGE = 1920;

/**
 * Resolution for an aspect ratio.
 *
 * Dimensions are rounded to even numbers because most video codecs (H.264,
 * H.265) require even width and height — an odd dimension is a real export
 * failure, not a cosmetic quirk.
 */
export function resolutionForAspect(ratio: number): Size {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

  if (ratio >= 1) {
    // Landscape or square: width is the long edge.
    return { width: even(REFERENCE_LONG_EDGE), height: even(REFERENCE_LONG_EDGE / ratio) };
  }
  // Portrait: height is the long edge.
  return { width: even(REFERENCE_LONG_EDGE * ratio), height: even(REFERENCE_LONG_EDGE) };
}

/** The preset id whose ratio matches a resolution, or "custom". */
export function aspectForResolution(size: Size): AspectRatioPreset {
  const ratio = size.width / size.height;
  const match = ASPECT_RATIOS.find((option) => Math.abs(option.ratio - ratio) < 0.01);
  return match?.id ?? "custom";
}

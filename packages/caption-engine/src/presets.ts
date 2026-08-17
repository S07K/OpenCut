/**
 * Caption style presets — plain data, so the community ships styles as JSON.
 *
 * Each preset is the complete visual spec for a caption track: font, colors,
 * stroke/shadow/background, words-per-block, entrance animation, and vertical
 * placement. The named presets echo the styles creators actually ask for; they
 * are starting points, every field editable per track.
 */

import type { CaptionPreset } from "@cutaway/types";

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: "core.captions.tiktok",
    name: "TikTok",
    fontFamily: "Inter",
    fontSize: 72,
    fontWeight: 800,
    uppercase: false,
    color: "#ffffff",
    activeWordColor: "#25f4ee",
    stroke: { enabled: true, color: "#000000", width: 8 },
    shadow: { enabled: true, color: "#000000", offsetY: 2, blur: 6 },
    background: { enabled: false, color: "#000000", padding: 0, cornerRadius: 0 },
    wordsPerBlock: 3,
    animationId: "core.captions.pop",
    positionY: 0.78,
  },
  {
    id: "core.captions.hormozi",
    name: "Hormozi",
    fontFamily: "Inter",
    fontSize: 84,
    fontWeight: 900,
    uppercase: true,
    color: "#ffffff",
    activeWordColor: "#ffd400",
    stroke: { enabled: true, color: "#000000", width: 10 },
    shadow: { enabled: true, color: "#000000", offsetY: 3, blur: 4 },
    background: { enabled: false, color: "#000000", padding: 0, cornerRadius: 0 },
    // One word at a time is the hallmark of the style.
    wordsPerBlock: 1,
    animationId: "core.captions.pop",
    positionY: 0.7,
  },
  {
    id: "core.captions.mrbeast",
    name: "MrBeast",
    fontFamily: "Inter",
    fontSize: 80,
    fontWeight: 900,
    uppercase: true,
    color: "#ffffff",
    activeWordColor: "#ff2d2d",
    stroke: { enabled: true, color: "#000000", width: 12 },
    shadow: { enabled: true, color: "#000000", offsetY: 4, blur: 0 },
    background: { enabled: false, color: "#000000", padding: 0, cornerRadius: 0 },
    wordsPerBlock: 2,
    animationId: "core.captions.pop",
    positionY: 0.75,
  },
  {
    id: "core.captions.instagram",
    name: "Instagram",
    fontFamily: "Inter",
    fontSize: 60,
    fontWeight: 700,
    uppercase: false,
    color: "#ffffff",
    activeWordColor: "#ffffff",
    stroke: { enabled: false, color: "#000000", width: 0 },
    shadow: { enabled: false, color: "#000000", offsetY: 0, blur: 0 },
    // The pill-background look, no stroke.
    background: { enabled: true, color: "#000000", padding: 18, cornerRadius: 12 },
    wordsPerBlock: 4,
    animationId: "core.captions.fade",
    positionY: 0.82,
  },
  {
    id: "core.captions.ali-abdaal",
    name: "Ali Abdaal",
    fontFamily: "Inter",
    fontSize: 56,
    fontWeight: 600,
    uppercase: false,
    color: "#ffffff",
    activeWordColor: "#7cc3ff",
    stroke: { enabled: false, color: "#000000", width: 0 },
    shadow: { enabled: true, color: "#000000", offsetY: 1, blur: 8 },
    background: { enabled: false, color: "#000000", padding: 0, cornerRadius: 0 },
    // Cleaner, more text on screen — the explainer look.
    wordsPerBlock: 5,
    animationId: "core.captions.fade",
    positionY: 0.85,
  },
];

export const DEFAULT_CAPTION_PRESET_ID = "core.captions.tiktok";

export function getCaptionPreset(id: string): CaptionPreset {
  return (
    CAPTION_PRESETS.find((preset) => preset.id === id) ??
    CAPTION_PRESETS.find((preset) => preset.id === DEFAULT_CAPTION_PRESET_ID)!
  );
}

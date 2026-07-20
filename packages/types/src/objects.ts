/**
 * The object system.
 *
 * Design rule: **composition over inheritance.** A clip is a small envelope
 * (`ClipBase`) holding timing and a `content` payload that varies by kind. The
 * envelope carries everything that is universal — transform, opacity, masks,
 * effects, grade — so a feature written against `ClipBase` automatically works
 * for video, text, shapes, and any future object kind, including ones plugins
 * introduce. Adding a new object type means adding one `content` variant, not
 * touching the transform, mask, or animation code.
 */

import type { Animatable } from "./animation.js";
import type { ColorGrade } from "./color.js";
import type { EffectInstance } from "./effects.js";
import type { Mask } from "./mask.js";
import type { Degrees, Frame, FrameDuration, Id, Unit, Vec2 } from "./primitives.js";

/** Spatial transform shared by every visual object. */
export interface Transform {
  /** Position of the object's anchor, in project pixel space. */
  position: Animatable<Vec2>;
  scale: Animatable<Vec2>;
  rotation: Animatable<Degrees>;
  /** Normalized 0..1 anchor within the object's own bounds. */
  anchor: Animatable<Vec2>;
  skew: Animatable<Vec2>;
}

/** Presentation properties applied after the transform. */
export interface Appearance {
  opacity: Animatable<Unit>;
  blur: Animatable<number>;
  cornerRadius: Animatable<number>;
  shadow: {
    enabled: boolean;
    color: Animatable<string>;
    offset: Animatable<Vec2>;
    blur: Animatable<number>;
    opacity: Animatable<Unit>;
  };
  /** Inset crop in pixels from each edge of the source. */
  crop: Animatable<{ top: number; right: number; bottom: number; left: number }>;
  blendMode: BlendMode;
}

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

// ---------------------------------------------------------------------------
// Content payloads
// ---------------------------------------------------------------------------

export interface VideoContent {
  kind: "video";
  mediaId: Id;
  /** Offset into the source media where this clip begins, in frames. */
  sourceInFrame: Frame;
  /** Playback rate multiplier; 2 = double speed. Affects consumed source. */
  speed: number;
  volume: Animatable<Unit>;
  muted: boolean;
}

export interface AudioContent {
  kind: "audio";
  mediaId: Id;
  sourceInFrame: Frame;
  speed: number;
  volume: Animatable<Unit>;
  muted: boolean;
  fadeInFrames: FrameDuration;
  fadeOutFrames: FrameDuration;
}

export interface ImageContent {
  kind: "image";
  mediaId: Id;
}

export interface GifContent {
  kind: "gif";
  mediaId: Id;
  loop: boolean;
}

export interface TextContent {
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: Animatable<number>;
  fontWeight: number;
  italic: boolean;
  color: Animatable<string>;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: Animatable<number>;
  stroke: { enabled: boolean; color: string; width: Animatable<number> };
  background: { enabled: boolean; color: string; padding: number; cornerRadius: number };
  /** Fixed box width for wrapping; `null` means auto-size to content. */
  maxWidth: number | null;
}

export interface ShapeContent {
  kind: "shape";
  shape: "rectangle" | "ellipse" | "triangle" | "polygon" | "star" | "line";
  fill: Animatable<string>;
  stroke: { enabled: boolean; color: Animatable<string>; width: Animatable<number> };
  /** For polygon/star. */
  sides: number;
  size: Animatable<Vec2>;
}

export interface SvgContent {
  kind: "svg";
  /** Raw SVG markup, sanitized on import. */
  markup: string;
  /** Optional per-path fill overrides, keyed by element id. */
  fillOverrides: Record<string, string>;
}

export interface StickerContent {
  kind: "sticker";
  mediaId: Id;
}

export interface EmojiContent {
  kind: "emoji";
  emoji: string;
  size: Animatable<number>;
}

/**
 * Escape hatch for plugin-defined object kinds. The core renderer delegates to
 * the plugin's registered renderer; the document stays valid either way, so a
 * project opened without its plugin degrades to a placeholder instead of
 * failing to load.
 */
export interface PluginContent {
  kind: "plugin";
  /** Registry key of the plugin object renderer. */
  contentType: string;
  data: Record<string, unknown>;
}

export type ClipContent =
  | VideoContent
  | AudioContent
  | ImageContent
  | GifContent
  | TextContent
  | ShapeContent
  | SvgContent
  | StickerContent
  | EmojiContent
  | PluginContent;

export type ClipKind = ClipContent["kind"];

// ---------------------------------------------------------------------------
// Clip
// ---------------------------------------------------------------------------

export interface Clip {
  id: Id;
  name: string;
  trackId: Id;

  /** Placement on the timeline. `[startFrame, startFrame + durationFrames)` */
  startFrame: Frame;
  durationFrames: FrameDuration;

  content: ClipContent;

  transform: Transform;
  appearance: Appearance;
  masks: Mask[];
  effects: EffectInstance[];
  grade: ColorGrade | null;

  locked: boolean;
  hidden: boolean;
  /** Clips sharing a group id move and trim together. */
  groupId: Id | null;
}

/** Convenience predicate — audio clips have no visual representation. */
export function isVisualClip(clip: Clip): boolean {
  return clip.content.kind !== "audio";
}

/**
 * Scene resolution.
 *
 * `resolveScene` turns a project document plus a frame number into a flat,
 * fully-resolved list of things to draw. Every `Animatable` is evaluated, every
 * clip is filtered by visibility, and draw order is settled.
 *
 * This is the architectural keystone: the realtime preview and the headless
 * exporter both call this same function. There is no second implementation of
 * "what does frame N look like", which is what makes export-matches-preview a
 * structural guarantee rather than a promise maintained by hand.
 *
 * It is pure and DOM-free — it resolves *what* to draw, never *how*. Backends
 * (PixiJS today, WebCodecs-driven export later) consume the result.
 */

import type {
  BlendMode,
  Clip,
  ClipContent,
  Frame,
  Id,
  ProjectDocument,
  Size,
  Vec2,
} from "@opencut/types";
import { evaluate } from "@opencut/animation-engine";

/** A transform with every animated property resolved to a concrete value. */
export interface ResolvedTransform {
  position: Vec2;
  scale: Vec2;
  rotation: number;
  anchor: Vec2;
  skew: Vec2;
}

export interface ResolvedAppearance {
  opacity: number;
  blur: number;
  cornerRadius: number;
  blendMode: BlendMode;
  shadow: {
    enabled: boolean;
    color: string;
    offset: Vec2;
    blur: number;
    opacity: number;
  };
  crop: { top: number; right: number; bottom: number; left: number };
}

/** Text properties resolved at a frame. */
export interface ResolvedText {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  stroke: { enabled: boolean; color: string; width: number };
  background: { enabled: boolean; color: string; padding: number; cornerRadius: number };
  maxWidth: number | null;
}

export interface ResolvedShape {
  shape: "rectangle" | "ellipse" | "triangle" | "polygon" | "star" | "line";
  fill: string;
  stroke: { enabled: boolean; color: string; width: number };
  sides: number;
  size: Vec2;
}

/** What a node draws, with values resolved for the current frame. */
export type ResolvedContent =
  | {
      kind: "media";
      mediaId: Id;
      /**
       * Time within the source media to display, in seconds.
       *
       * Seconds rather than frames because this is handed to `<video>` and to
       * WebCodecs, both of which are time-based. The conversion happens here,
       * once, instead of at every call site.
       */
      sourceTimeSeconds: number;
      mediaKind: "video" | "image" | "gif";
    }
  | { kind: "text"; text: ResolvedText }
  | { kind: "shape"; shape: ResolvedShape }
  | { kind: "emoji"; emoji: string; size: number }
  | { kind: "svg"; markup: string }
  | { kind: "plugin"; contentType: string; data: Record<string, unknown> };

export interface SceneNode {
  clipId: Id;
  trackId: Id;
  /** Ascending; higher values draw on top. */
  zIndex: number;
  transform: ResolvedTransform;
  appearance: ResolvedAppearance;
  content: ResolvedContent;
  hasMasks: boolean;
  hasGrade: boolean;
}

export interface AudioNode {
  clipId: Id;
  mediaId: Id;
  sourceTimeSeconds: number;
  volume: number;
  muted: boolean;
}

export interface Scene {
  frame: Frame;
  resolution: Size;
  backgroundColor: string;
  /** Visual nodes in draw order, back to front. */
  nodes: SceneNode[];
  /** Audio that should be sounding at this frame. */
  audio: AudioNode[];
}

/** True when `frame` falls within the clip's half-open range. */
function isClipActive(clip: Clip, frame: Frame): boolean {
  return frame >= clip.startFrame && frame < clip.startFrame + clip.durationFrames;
}

function resolveTransform(clip: Clip, frame: Frame): ResolvedTransform {
  const { transform } = clip;
  return {
    position: evaluate(transform.position, frame),
    scale: evaluate(transform.scale, frame),
    rotation: evaluate(transform.rotation, frame),
    anchor: evaluate(transform.anchor, frame),
    skew: evaluate(transform.skew, frame),
  };
}

function resolveAppearance(clip: Clip, frame: Frame): ResolvedAppearance {
  const { appearance } = clip;
  return {
    opacity: evaluate(appearance.opacity, frame),
    blur: evaluate(appearance.blur, frame),
    cornerRadius: evaluate(appearance.cornerRadius, frame),
    blendMode: appearance.blendMode,
    shadow: {
      enabled: appearance.shadow.enabled,
      color: evaluate(appearance.shadow.color, frame),
      offset: evaluate(appearance.shadow.offset, frame),
      blur: evaluate(appearance.shadow.blur, frame),
      opacity: evaluate(appearance.shadow.opacity, frame),
    },
    crop: evaluate(appearance.crop, frame),
  };
}

/**
 * Time within the source media for a clip at a timeline frame.
 *
 * Accounts for the clip's in-point and playback speed. A clip at 2x consumes
 * two source frames per timeline frame, so this is not simply elapsed time.
 */
export function sourceTimeFor(
  clip: Clip,
  frame: Frame,
  sourceInFrame: number,
  speed: number,
  frameRate: number,
): number {
  const elapsed = frame - clip.startFrame;
  return (sourceInFrame + elapsed * speed) / frameRate;
}

function resolveContent(clip: Clip, frame: Frame, frameRate: number): ResolvedContent | null {
  const content: ClipContent = clip.content;

  switch (content.kind) {
    case "video":
      return {
        kind: "media",
        mediaId: content.mediaId,
        sourceTimeSeconds: sourceTimeFor(
          clip,
          frame,
          content.sourceInFrame,
          content.speed,
          frameRate,
        ),
        mediaKind: "video",
      };

    case "image":
    case "sticker":
      return { kind: "media", mediaId: content.mediaId, sourceTimeSeconds: 0, mediaKind: "image" };

    case "gif":
      return {
        kind: "media",
        mediaId: content.mediaId,
        sourceTimeSeconds: (frame - clip.startFrame) / frameRate,
        mediaKind: "gif",
      };

    case "text":
      return {
        kind: "text",
        text: {
          text: content.text,
          fontFamily: content.fontFamily,
          fontSize: evaluate(content.fontSize, frame),
          fontWeight: content.fontWeight,
          italic: content.italic,
          color: evaluate(content.color, frame),
          align: content.align,
          lineHeight: content.lineHeight,
          letterSpacing: evaluate(content.letterSpacing, frame),
          stroke: {
            enabled: content.stroke.enabled,
            color: content.stroke.color,
            width: evaluate(content.stroke.width, frame),
          },
          background: content.background,
          maxWidth: content.maxWidth,
        },
      };

    case "shape":
      return {
        kind: "shape",
        shape: {
          shape: content.shape,
          fill: evaluate(content.fill, frame),
          stroke: {
            enabled: content.stroke.enabled,
            color: evaluate(content.stroke.color, frame),
            width: evaluate(content.stroke.width, frame),
          },
          sides: content.sides,
          size: evaluate(content.size, frame),
        },
      };

    case "emoji":
      return { kind: "emoji", emoji: content.emoji, size: evaluate(content.size, frame) };

    case "svg":
      return { kind: "svg", markup: content.markup };

    case "plugin":
      return { kind: "plugin", contentType: content.contentType, data: content.data };

    case "audio":
      // Audio produces no visual node; it is collected separately.
      return null;

    default:
      return null;
  }
}

/**
 * Resolves the project to a drawable scene at `frame`.
 *
 * Hidden and locked-out content is filtered here rather than in the backend, so
 * that every backend agrees on what is visible without reimplementing the rules.
 */
export function resolveScene(project: ProjectDocument, frame: Frame): Scene {
  const { entities, settings, trackOrder } = project;
  const frameRate = settings.frameRate;

  const nodes: SceneNode[] = [];
  const audio: AudioNode[] = [];

  // Solo behaves as an override: if any track of a kind is soloed, every other
  // track of that kind is silenced regardless of its own mute flag.
  const hasSoloedAudio = Object.values(entities.tracks).some(
    (track) => track.kind === "audio" && track.solo,
  );

  trackOrder.forEach((trackId, trackIndex) => {
    const track = entities.tracks[trackId];
    if (!track) return;

    const clips = Object.values(entities.clips).filter(
      (clip) => clip.trackId === trackId && isClipActive(clip, frame),
    );

    for (const clip of clips) {
      if (clip.content.kind === "audio") {
        const audible = hasSoloedAudio ? track.solo : !track.muted;
        if (!audible || clip.hidden) continue;

        audio.push({
          clipId: clip.id,
          mediaId: clip.content.mediaId,
          sourceTimeSeconds: sourceTimeFor(
            clip,
            frame,
            clip.content.sourceInFrame,
            clip.content.speed,
            frameRate,
          ),
          volume: evaluate(clip.content.volume, frame) * track.volume,
          muted: clip.content.muted,
        });
        continue;
      }

      if (track.hidden || clip.hidden) continue;

      const content = resolveContent(clip, frame, frameRate);
      if (!content) continue;

      nodes.push({
        clipId: clip.id,
        trackId,
        // Track order dominates so a clip can never draw above a clip on a
        // higher track; the clip's own start frame only breaks ties within a
        // track, giving a stable order for overlapping clips.
        zIndex: trackIndex * 1_000_000 + clip.startFrame,
        transform: resolveTransform(clip, frame),
        appearance: resolveAppearance(clip, frame),
        content,
        hasMasks: clip.masks.some((mask) => mask.enabled),
        hasGrade: clip.grade?.enabled ?? false,
      });
    }
  });

  nodes.sort((a, b) => a.zIndex - b.zIndex);

  return {
    frame,
    resolution: settings.resolution,
    backgroundColor: settings.backgroundColor,
    nodes,
    audio,
  };
}

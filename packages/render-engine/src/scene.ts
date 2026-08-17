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
import type { CaptionPreset } from "@opencut/types";
import { evaluate } from "@opencut/animation-engine";
import { resolveMasks, type ResolvedMask } from "@opencut/mask-engine";
import { activeWordIndex, blockAtFrame, getCaptionPreset } from "@opencut/caption-engine";
import { isNeutralGrade, resolveGrade, type ResolvedGrade } from "@opencut/color-engine";
import { resolveEffects, type ResolvedEffect } from "@opencut/effects-engine";

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
  /**
   * Masks resolved to geometry at this frame, in stack order. Empty when the
   * clip has no enabled masks. The compositor fills these polygons; the scene
   * carries the shapes so preview and export mask identically.
   */
  masks: ResolvedMask[];
  /**
   * The colour grade resolved for this frame, or null when the clip has no
   * enabled, non-neutral grade. A neutral grade resolves to null so the
   * compositor skips the shader pass entirely.
   */
  grade: ResolvedGrade | null;
  /**
   * The clip's effect stack resolved for this frame, in application order.
   * Empty when the clip has no enabled effects. Each entry is a registry id
   * plus flat parameter values; the compositor maps ids to renderer filters.
   */
  effects: ResolvedEffect[];
}

export interface AudioNode {
  clipId: Id;
  mediaId: Id;
  sourceTimeSeconds: number;
  volume: number;
  muted: boolean;
}

/** A caption word resolved for drawing, with its highlight state. */
export interface ResolvedCaptionWord {
  text: string;
  /** True for the word under the playhead — the compositor tints this one. */
  active: boolean;
}

/**
 * The caption visible at the current frame, fully styled.
 *
 * Derived from the transcript's word data plus the track preset, so restyling
 * or re-timing is instant and never touches the words themselves.
 */
export interface ResolvedCaption {
  words: ResolvedCaptionWord[];
  preset: CaptionPreset;
}

export interface Scene {
  frame: Frame;
  resolution: Size;
  backgroundColor: string;
  /** Visual nodes in draw order, back to front. */
  nodes: SceneNode[];
  /** Audio that should be sounding at this frame. */
  audio: AudioNode[];
  /** The caption to overlay at this frame, or null. Drawn above all nodes. */
  caption: ResolvedCaption | null;
}

/** True when `frame` falls within the clip's half-open range. */
function isClipActive(clip: Clip, frame: Frame): boolean {
  return frame >= clip.startFrame && frame < clip.startFrame + clip.durationFrames;
}

/**
 * The opacity multiplier for a clip at `frame` under the transition model, or
 * null when the clip is not visible at all.
 *
 * Two overlap cases, both driven by the *incoming* clip's `transitionIn`:
 * - This clip is the incoming side: it fades in over its first D frames.
 * - This clip is the outgoing side: the next clip's transition renders it past
 *   its own end (a tail) while it fades out, so the two overlap across the cut.
 *
 * `crossfade` fades the two linearly into each other; `dip` routes both through
 * black — the outgoing to black over the first half, the incoming up over the
 * second — so nothing double-exposes.
 */
export function transitionOpacity(clip: Clip, next: Clip | undefined, frame: Frame): number | null {
  const start = clip.startFrame;
  const end = clip.startFrame + clip.durationFrames;

  // Normal visibility, with an incoming fade at the head.
  if (frame >= start && frame < end) {
    const transition = clip.transitionIn;
    if (transition && transition.durationFrames > 0 && frame < start + transition.durationFrames) {
      const t = (frame - start) / transition.durationFrames;
      return transition.kind === "dip" ? Math.max(0, t * 2 - 1) : t;
    }
    return 1;
  }

  // Outgoing tail: the next clip's transition pulls this one past its end.
  const nextTransition = next?.transitionIn;
  if (
    next &&
    nextTransition &&
    nextTransition.durationFrames > 0 &&
    next.startFrame === end && // only an exact cut crossfades
    frame >= end &&
    frame < end + nextTransition.durationFrames
  ) {
    const t = (frame - end) / nextTransition.durationFrames;
    return nextTransition.kind === "dip" ? Math.max(0, 1 - t * 2) : 1 - t;
  }

  return null;
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

    // Sorted so each clip can see the one after it: a transition belongs to the
    // incoming clip and pulls the previous clip's tail forward across the cut.
    const trackClips = Object.values(entities.clips)
      .filter((clip) => clip.trackId === trackId)
      .sort((a, b) => a.startFrame - b.startFrame);

    trackClips.forEach((clip, index) => {
      if (clip.content.kind === "audio") {
        if (!isClipActive(clip, frame)) return;
        const audible = hasSoloedAudio ? track.solo : !track.muted;
        if (!audible || clip.hidden) return;

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
        return;
      }

      if (track.hidden || clip.hidden) return;

      // Visibility and opacity both come from the transition model: a clip may
      // draw past its end (an outgoing tail) or start faded (an incoming fade).
      const factor = transitionOpacity(clip, trackClips[index + 1], frame);
      if (factor === null) return;

      const content = resolveContent(clip, frame, frameRate);
      if (!content) return;

      const appearance = resolveAppearance(clip, frame);

      nodes.push({
        clipId: clip.id,
        trackId,
        // Track order dominates so a clip can never draw above a clip on a
        // higher track; the clip's own start frame only breaks ties within a
        // track, giving a stable order for overlapping clips. Earlier tracks in
        // `trackOrder` sit higher in the timeline UI and draw in *front*, the
        // standard NLE convention (top layer wins), so z decreases with index.
        zIndex: (trackOrder.length - trackIndex) * 1_000_000 + clip.startFrame,
        transform: resolveTransform(clip, frame),
        appearance:
          factor === 1 ? appearance : { ...appearance, opacity: appearance.opacity * factor },
        content,
        masks: resolveMasks(clip.masks, frame),
        grade: resolveClipGrade(clip, frame),
        effects: resolveEffects(clip.effects, frame),
      });
    });
  });

  nodes.sort((a, b) => a.zIndex - b.zIndex);

  return {
    frame,
    resolution: settings.resolution,
    backgroundColor: settings.backgroundColor,
    nodes,
    audio,
    caption: resolveCaption(project, frame),
  };
}

/**
 * Resolves a clip's colour grade at `frame`, or null.
 *
 * Returns null for a disabled grade *and* for one whose values are all neutral,
 * so the compositor never runs a full-frame shader that would change nothing.
 */
function resolveClipGrade(clip: Clip, frame: Frame): ResolvedGrade | null {
  if (!clip.grade?.enabled) return null;
  const resolved = resolveGrade(clip.grade, frame);
  return isNeutralGrade(resolved) ? null : resolved;
}

/**
 * Resolves the caption to show at `frame`, across all caption tracks.
 *
 * The first track with an active block wins — overlapping caption tracks are
 * unusual, and picking one keeps the overlay unambiguous. Word highlighting is
 * baked in here so the compositor stays a dumb renderer.
 */
function resolveCaption(project: ProjectDocument, frame: Frame): ResolvedCaption | null {
  for (const track of Object.values(project.entities.captionTracks)) {
    const block = blockAtFrame(track.blocks, frame);
    if (!block) continue;

    const active = activeWordIndex(block, frame);
    return {
      preset: getCaptionPreset(track.presetId),
      words: block.words.map((word, index) => ({ text: word.text, active: index === active })),
    };
  }
  return null;
}

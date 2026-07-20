/**
 * Document factories.
 *
 * Every valid document is built through these. Constructing clips inline
 * scatters defaults across the codebase, and the first time a new field is
 * added to `Clip` you discover six places that forgot it. One factory means one
 * place to update.
 */

import type {
  Appearance,
  Clip,
  ClipContent,
  ColorGrade,
  ExportSettings,
  Id,
  ProjectDocument,
  ProjectSettings,
  Size,
  Track,
  TrackKind,
  Transform,
} from "@opencut/types";
import { SCHEMA_VERSION, staticValue } from "@opencut/types";
import { createId } from "./id";

export function createTransform(overrides: Partial<Transform> = {}): Transform {
  return {
    position: staticValue({ x: 0, y: 0 }),
    scale: staticValue({ x: 1, y: 1 }),
    rotation: staticValue(0),
    anchor: staticValue({ x: 0.5, y: 0.5 }),
    skew: staticValue({ x: 0, y: 0 }),
    ...overrides,
  };
}

export function createAppearance(overrides: Partial<Appearance> = {}): Appearance {
  return {
    opacity: staticValue(1),
    blur: staticValue(0),
    cornerRadius: staticValue(0),
    shadow: {
      enabled: false,
      color: staticValue("#000000"),
      offset: staticValue({ x: 0, y: 4 }),
      blur: staticValue(12),
      opacity: staticValue(0.5),
    },
    crop: staticValue({ top: 0, right: 0, bottom: 0, left: 0 }),
    blendMode: "normal",
    ...overrides,
  };
}

/** A neutral grade — every field at its "unchanged" value. */
export function createColorGrade(): ColorGrade {
  const neutralWheel = () => ({
    offset: staticValue({ x: 0, y: 0 }),
    level: staticValue(0),
  });

  return {
    enabled: false,
    brightness: staticValue(0),
    contrast: staticValue(0),
    exposure: staticValue(0),
    shadows: staticValue(0),
    highlights: staticValue(0),
    whites: staticValue(0),
    blacks: staticValue(0),
    temperature: staticValue(0),
    tint: staticValue(0),
    saturation: staticValue(0),
    vibrance: staticValue(0),
    curves: {
      // The identity curve: input maps to output unchanged.
      master: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      red: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      green: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      blue: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
    wheels: { lift: neutralWheel(), gamma: neutralWheel(), gain: neutralWheel() },
    vignette: {
      amount: staticValue(0),
      radius: staticValue(0.7),
      softness: staticValue(0.5),
    },
    grain: { amount: staticValue(0), size: staticValue(1) },
  };
}

export interface CreateClipOptions {
  id?: Id;
  name?: string;
  trackId: Id;
  startFrame: number;
  durationFrames: number;
  content: ClipContent;
}

export function createClip(options: CreateClipOptions): Clip {
  return {
    id: options.id ?? createId("clip"),
    name: options.name ?? defaultClipName(options.content),
    trackId: options.trackId,
    startFrame: options.startFrame,
    durationFrames: options.durationFrames,
    content: options.content,
    transform: createTransform(),
    appearance: createAppearance(),
    masks: [],
    effects: [],
    // Null rather than a neutral grade: a grade object per clip would bloat
    // every project file with values that mean "do nothing".
    grade: null,
    locked: false,
    hidden: false,
    groupId: null,
  };
}

function defaultClipName(content: ClipContent): string {
  switch (content.kind) {
    case "text":
      return content.text.slice(0, 24) || "Text";
    case "shape":
      return content.shape.charAt(0).toUpperCase() + content.shape.slice(1);
    case "emoji":
      return content.emoji;
    default:
      return content.kind.charAt(0).toUpperCase() + content.kind.slice(1);
  }
}

export interface CreateTrackOptions {
  id?: Id;
  name?: string;
  kind: TrackKind;
  index: number;
}

export function createTrack(options: CreateTrackOptions): Track {
  return {
    id: options.id ?? createId("track"),
    name: options.name ?? `${options.kind.charAt(0).toUpperCase()}${options.kind.slice(1)} ${options.index + 1}`,
    kind: options.kind,
    index: options.index,
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    height: options.kind === "audio" ? 56 : 64,
    volume: 1,
    effects: [],
  };
}

export const DEFAULT_RESOLUTION: Size = { width: 1920, height: 1080 };

export function createProjectSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return {
    resolution: DEFAULT_RESOLUTION,
    aspectRatio: "16:9",
    frameRate: 30,
    backgroundColor: "#000000",
    sampleRate: 48000,
    ...overrides,
  };
}

export function createExportSettings(settings: ProjectSettings): ExportSettings {
  return {
    format: "mp4",
    resolution: settings.resolution,
    frameRate: settings.frameRate,
    // ~8 Mbps at 1080p30 — the quality/size point most social platforms
    // re-encode from anyway, so going higher mostly wastes export time.
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
    videoCodec: "h264",
    audioCodec: "aac",
    range: null,
  };
}

export function createProject(name = "Untitled Project"): ProjectDocument {
  const settings = createProjectSettings();
  const now = Date.now();

  const videoTrack = createTrack({ kind: "video", index: 0, name: "Video 1" });
  const audioTrack = createTrack({ kind: "audio", index: 1, name: "Audio 1" });

  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId("project"),
    name,
    createdAt: now,
    modifiedAt: now,
    settings,
    entities: {
      clips: {},
      tracks: { [videoTrack.id]: videoTrack, [audioTrack.id]: audioTrack },
      media: {},
      markers: {},
      captionTracks: {},
    },
    trackOrder: [videoTrack.id, audioTrack.id],
    durationFrames: 0,
    exportSettings: createExportSettings(settings),
    requiredPlugins: [],
  };
}

/**
 * Loading validation and repair.
 *
 * Project files are plain JSON on the user's disk. They get hand-edited, synced
 * by tools that mangle them, truncated by full disks, and written by plugins
 * with bugs. So loading is **repair-oriented, not gatekeeping**: salvage every
 * clip that can be salvaged, drop what cannot, and report precisely what was
 * lost. Refusing to open a project because one clip references a deleted track
 * would be the worst possible outcome for someone with hours of work in it.
 */

import type { Clip, MediaAsset, ProjectDocument, Track } from "@cutaway/types";
import { createProject } from "@cutaway/utils";

export type IssueSeverity = "dropped" | "repaired";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** What was affected, e.g. `clip:abc123`. */
  subject: string;
  message: string;
}

export interface ValidationResult {
  project: ProjectDocument;
  issues: ValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Validates and repairs a raw document.
 *
 * Anything unrecoverable falls back to the corresponding piece of a fresh
 * project, so the return value is always a document the editor can open.
 */
export function validateProject(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const fallback = createProject();

  if (!isRecord(raw)) {
    issues.push({
      severity: "dropped",
      subject: "project",
      message: "File is not a project document; opened an empty project instead.",
    });
    return { project: fallback, issues };
  }

  const entities = isRecord(raw.entities) ? raw.entities : {};

  const tracks = validateTracks(entities.tracks, issues, fallback);
  const media = validateMedia(entities.media, issues);
  const clips = validateClips(entities.clips, tracks, media, issues);

  const trackOrder = validateTrackOrder(raw.trackOrder, tracks, issues);
  const settings = validateSettings(raw.settings, fallback);

  const durationFrames = Object.values(clips).reduce(
    (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
    0,
  );

  return {
    project: {
      schemaVersion: asFiniteNumber(raw.schemaVersion, fallback.schemaVersion),
      id: asString(raw.id, fallback.id),
      name: asString(raw.name, "Untitled Project"),
      createdAt: asFiniteNumber(raw.createdAt, Date.now()),
      modifiedAt: asFiniteNumber(raw.modifiedAt, Date.now()),
      settings,
      entities: {
        clips,
        tracks,
        media,
        markers: isRecord(entities.markers)
          ? (entities.markers as ProjectDocument["entities"]["markers"])
          : {},
        captionTracks: isRecord(entities.captionTracks)
          ? (entities.captionTracks as ProjectDocument["entities"]["captionTracks"])
          : {},
      },
      trackOrder,
      durationFrames,
      exportSettings: isRecord(raw.exportSettings)
        ? { ...fallback.exportSettings, ...(raw.exportSettings as object) }
        : fallback.exportSettings,
      requiredPlugins: Array.isArray(raw.requiredPlugins)
        ? raw.requiredPlugins.filter((id): id is string => typeof id === "string")
        : [],
    },
    issues,
  };
}

function validateSettings(raw: unknown, fallback: ProjectDocument): ProjectDocument["settings"] {
  if (!isRecord(raw)) return fallback.settings;

  const resolution = isRecord(raw.resolution) ? raw.resolution : {};

  return {
    ...fallback.settings,
    ...raw,
    // Guarded individually: a zero or negative dimension divides by zero in the
    // preview's aspect fit and produces an invisible, un-debuggable canvas.
    resolution: {
      width: Math.max(1, asFiniteNumber(resolution.width, fallback.settings.resolution.width)),
      height: Math.max(1, asFiniteNumber(resolution.height, fallback.settings.resolution.height)),
    },
    frameRate: Math.max(1, asFiniteNumber(raw.frameRate, fallback.settings.frameRate)),
  } as ProjectDocument["settings"];
}

function validateTracks(
  raw: unknown,
  issues: ValidationIssue[],
  fallback: ProjectDocument,
): Record<string, Track> {
  if (!isRecord(raw)) return fallback.entities.tracks;

  const tracks: Record<string, Track> = {};

  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.id !== "string") {
      issues.push({
        severity: "dropped",
        subject: `track:${id}`,
        message: "Track is malformed and was removed.",
      });
      continue;
    }
    tracks[id] = value as unknown as Track;
  }

  // A project with clips but no tracks cannot render anything, so give it the
  // default pair rather than opening onto an empty editor.
  if (Object.keys(tracks).length === 0) return fallback.entities.tracks;

  return tracks;
}

function validateMedia(raw: unknown, issues: ValidationIssue[]): Record<string, MediaAsset> {
  if (!isRecord(raw)) return {};

  const media: Record<string, MediaAsset> = {};

  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.source)) {
      issues.push({
        severity: "dropped",
        subject: `media:${id}`,
        message: "Media reference is malformed and was removed.",
      });
      continue;
    }
    media[id] = value as unknown as MediaAsset;
  }

  return media;
}

function validateClips(
  raw: unknown,
  tracks: Record<string, Track>,
  media: Record<string, MediaAsset>,
  issues: ValidationIssue[],
): Record<string, Clip> {
  if (!isRecord(raw)) return {};

  const clips: Record<string, Clip> = {};

  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.content)) {
      issues.push({
        severity: "dropped",
        subject: `clip:${id}`,
        message: "Clip is malformed and was removed.",
      });
      continue;
    }

    const clip = value as unknown as Clip;

    // Referential integrity. An orphaned clip would sit invisibly in the
    // document forever, contributing to duration and never rendering.
    if (!tracks[clip.trackId]) {
      issues.push({
        severity: "dropped",
        subject: `clip:${id}`,
        message: `Clip referenced a missing track and was removed.`,
      });
      continue;
    }

    const mediaId = "mediaId" in clip.content ? clip.content.mediaId : null;
    if (mediaId && !media[mediaId]) {
      issues.push({
        severity: "dropped",
        subject: `clip:${id}`,
        message: `Clip referenced missing media and was removed.`,
      });
      continue;
    }

    const startFrame = Math.max(0, Math.round(asFiniteNumber(clip.startFrame, 0)));
    const durationFrames = Math.max(1, Math.round(asFiniteNumber(clip.durationFrames, 1)));

    if (startFrame !== clip.startFrame || durationFrames !== clip.durationFrames) {
      issues.push({
        severity: "repaired",
        subject: `clip:${id}`,
        message: "Clip timing was out of range and has been clamped.",
      });
    }

    clips[id] = { ...clip, startFrame, durationFrames };
  }

  return clips;
}

function validateTrackOrder(
  raw: unknown,
  tracks: Record<string, Track>,
  issues: ValidationIssue[],
): string[] {
  const known = Object.keys(tracks);
  const order = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of order) {
    if (!tracks[id] || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  // Tracks missing from the order would exist but never render. Appending them
  // is always better than dropping the user's content.
  for (const id of known) {
    if (seen.has(id)) continue;
    result.push(id);
    issues.push({
      severity: "repaired",
      subject: `track:${id}`,
      message: "Track was missing from the render order and was appended.",
    });
  }

  return result;
}

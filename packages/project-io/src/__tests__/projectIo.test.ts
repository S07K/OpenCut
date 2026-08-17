import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, staticValue } from "@cutaway/types";
import { createClip, createProject, createTrack } from "@cutaway/utils";
import {
  parseProjectFile,
  projectFileName,
  referencedBlobKeys,
  serializeProject,
  PROJECT_FILE_MAGIC,
} from "../serialize";
import { validateProject } from "../validate";
import { migrateDocument } from "../migrate";
import type { MediaAsset, ProjectDocument } from "@cutaway/types";

function imageAsset(id: string): MediaAsset {
  return {
    id,
    name: `${id}.png`,
    kind: "image",
    mimeType: "image/png",
    source: { type: "indexeddb", key: `${id}:source` },
    metadata: {
      durationSeconds: 0,
      frameRate: null,
      dimensions: { width: 100, height: 100 },
      hasAudio: false,
      hasVideo: true,
      codec: null,
      sampleRate: null,
      channels: null,
      byteSize: 10,
    },
    thumbnailKey: `${id}:thumb`,
    waveformKey: null,
    importedAt: 0,
  };
}

/** A project with one track, one media asset, and one clip wired together. */
function populatedProject(): ProjectDocument {
  const base = createProject("Test");
  const track = createTrack({ kind: "video", index: 0 });
  const asset = imageAsset("m1");
  const clip = createClip({
    trackId: track.id,
    startFrame: 10,
    durationFrames: 50,
    content: { kind: "image", mediaId: asset.id },
  });

  return {
    ...base,
    entities: {
      ...base.entities,
      tracks: { [track.id]: track },
      media: { [asset.id]: asset },
      clips: { [clip.id]: clip },
    },
    trackOrder: [track.id],
    durationFrames: 60,
  };
}

describe("round trip", () => {
  it("preserves the project exactly", () => {
    const project = populatedProject();
    const result = parseProjectFile(serializeProject(project));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.issues).toEqual([]);
    expect(result.project).toEqual(project);
  });

  it("writes a self-identifying, human-readable file", () => {
    const text = serializeProject(populatedProject());
    const parsed = JSON.parse(text);

    expect(parsed.magic).toBe(PROJECT_FILE_MAGIC);
    // Indented so the file diffs cleanly in git.
    expect(text).toContain("\n  ");
  });
});

describe("parseProjectFile", () => {
  it("rejects non-JSON", () => {
    const result = parseProjectFile("not json {{{");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/valid JSON/i);
  });

  it("rejects a JSON file that is not an Cutaway project", () => {
    const result = parseProjectFile(JSON.stringify({ magic: "something.else" }));
    expect(result.ok).toBe(false);
  });

  it("accepts a bare document with no envelope", () => {
    // Users hand-edit and paste these around; refusing one for lacking an
    // envelope would be pedantry.
    const result = parseProjectFile(JSON.stringify(populatedProject()));
    expect(result.ok).toBe(true);
  });

  it("never throws on arbitrary junk", () => {
    for (const input of ["null", "[]", "42", '"str"', "{}", '{"entities":null}']) {
      expect(() => parseProjectFile(input)).not.toThrow();
    }
  });
});

describe("validateProject repair", () => {
  it("drops clips referencing a missing track", () => {
    const project = populatedProject();
    const broken = {
      ...project,
      entities: {
        ...project.entities,
        clips: {
          ...project.entities.clips,
          ghost: {
            ...Object.values(project.entities.clips)[0]!,
            id: "ghost",
            trackId: "does-not-exist",
          },
        },
      },
    };

    const { project: repaired, issues } = validateProject(broken);

    expect(repaired.entities.clips.ghost).toBeUndefined();
    expect(issues.some((i) => i.subject === "clip:ghost" && i.severity === "dropped")).toBe(true);
  });

  it("drops clips referencing missing media", () => {
    const project = populatedProject();
    const broken = {
      ...project,
      entities: { ...project.entities, media: {} },
    };

    const { project: repaired, issues } = validateProject(broken);

    expect(Object.keys(repaired.entities.clips)).toHaveLength(0);
    expect(issues.some((i) => i.message.match(/missing media/i))).toBe(true);
  });

  it("appends tracks missing from the render order", () => {
    const project = populatedProject();
    const broken = { ...project, trackOrder: [] };

    const { project: repaired, issues } = validateProject(broken);

    // A track absent from the order would exist but never render.
    expect(repaired.trackOrder).toHaveLength(1);
    expect(issues.some((i) => i.severity === "repaired")).toBe(true);
  });

  it("removes duplicate and unknown ids from the render order", () => {
    const project = populatedProject();
    const trackId = project.trackOrder[0]!;
    const broken = { ...project, trackOrder: [trackId, trackId, "bogus"] };

    expect(validateProject(broken).project.trackOrder).toEqual([trackId]);
  });

  it("clamps negative and zero clip timing", () => {
    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;
    const broken = {
      ...project,
      entities: {
        ...project.entities,
        clips: {
          [clipId]: {
            ...project.entities.clips[clipId]!,
            startFrame: -50,
            durationFrames: 0,
          },
        },
      },
    };

    const { project: repaired, issues } = validateProject(broken);
    const clip = repaired.entities.clips[clipId]!;

    expect(clip.startFrame).toBe(0);
    // A zero-length clip is unselectable and unrenderable.
    expect(clip.durationFrames).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.severity === "repaired")).toBe(true);
  });

  it("rejects a zero resolution that would break the preview", () => {
    const project = populatedProject();
    const broken = {
      ...project,
      settings: { ...project.settings, resolution: { width: 0, height: 0 } },
    };

    const { project: repaired } = validateProject(broken);
    expect(repaired.settings.resolution.width).toBeGreaterThan(0);
    expect(repaired.settings.resolution.height).toBeGreaterThan(0);
  });

  it("falls back to an empty project for non-object input", () => {
    const { project, issues } = validateProject("nonsense");
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(issues[0]!.severity).toBe("dropped");
  });

  it("recomputes duration from the surviving clips", () => {
    const project = populatedProject();
    const lying = { ...project, durationFrames: 999_999 };

    expect(validateProject(lying).project.durationFrames).toBe(60);
  });
});

describe("migrateDocument", () => {
  it("stamps the current version on an unversioned document", () => {
    expect(migrateDocument({}).document.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("flags documents from a newer build instead of downgrading them", () => {
    const result = migrateDocument({ schemaVersion: SCHEMA_VERSION + 5 });
    expect(result.fromFuture).toBe(true);
  });

  it("leaves a current document untouched", () => {
    const result = migrateDocument({ schemaVersion: SCHEMA_VERSION, name: "x" });
    expect(result.applied).toEqual([]);
    expect(result.document.name).toBe("x");
  });
});

describe("referencedBlobKeys", () => {
  it("collects source, thumbnail, and waveform keys", () => {
    const keys = referencedBlobKeys(populatedProject());
    expect(keys.has("m1:source")).toBe(true);
    expect(keys.has("m1:thumb")).toBe(true);
  });

  it("is empty for a project with no media", () => {
    expect(referencedBlobKeys(createProject()).size).toBe(0);
  });
});

describe("projectFileName", () => {
  it("produces a filesystem-safe name", () => {
    // Disallowed characters are stripped, then whitespace runs collapse to a
    // single dash — so "/ " does not leave a double dash behind.
    expect(projectFileName("My Video / 2026!")).toBe("My-Video-2026.cutaway");
    expect(projectFileName("   ")).toBe("untitled.cutaway");
  });
});

describe("serialization safety", () => {
  it("survives a project containing an animated property", () => {
    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;
    const animated: ProjectDocument = {
      ...project,
      entities: {
        ...project.entities,
        clips: {
          [clipId]: {
            ...project.entities.clips[clipId]!,
            appearance: {
              ...project.entities.clips[clipId]!.appearance,
              opacity: {
                type: "animated",
                keyframes: [
                  { frame: 0, value: 0, easing: { kind: "linear" } },
                  {
                    frame: 30,
                    value: 1,
                    easing: { kind: "spring", stiffness: 180, damping: 12, mass: 1 },
                  },
                ],
              },
            },
          },
        },
      },
    };

    const result = parseProjectFile(serializeProject(animated));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project).toEqual(animated);
  });

  it("keeps static values intact", () => {
    const value = staticValue({ x: 1, y: 2 });
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});

import { describe, expect, it } from "vitest";
import { staticValue, SCHEMA_VERSION } from "@cutaway/types";
import { createClip, createProject, createTrack } from "../factories";
import { createId } from "../id";
import { ASPECT_RATIOS, aspectForResolution, resolutionForAspect } from "../aspect";

describe("createProject", () => {
  it("stamps the current schema version", () => {
    expect(createProject().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("starts with tracks but no clips", () => {
    const project = createProject();

    expect(Object.keys(project.entities.clips)).toHaveLength(0);
    expect(project.trackOrder).toHaveLength(2);
    expect(project.durationFrames).toBe(0);
  });

  it("keeps trackOrder consistent with the track table", () => {
    const project = createProject();

    for (const trackId of project.trackOrder) {
      expect(project.entities.tracks[trackId]).toBeDefined();
    }
  });
});

describe("document serializability", () => {
  /**
   * This is the load-bearing invariant of the whole format: if a document does
   * not survive a JSON round-trip unchanged, saving silently corrupts projects.
   * A `Date`, `Map`, `Set`, or `undefined` sneaking into a factory would be
   * caught here and nowhere else.
   */
  it("round-trips a populated project through JSON unchanged", () => {
    const base = createProject("Round Trip");
    const track = createTrack({ kind: "video", index: 0 });

    const clip = createClip({
      trackId: track.id,
      startFrame: 12,
      durationFrames: 48,
      content: {
        kind: "text",
        text: "Hello",
        fontFamily: "Inter",
        fontSize: staticValue(64),
        fontWeight: 700,
        italic: false,
        color: staticValue("#ffffff"),
        align: "center",
        lineHeight: 1.2,
        letterSpacing: staticValue(0),
        stroke: { enabled: false, color: "#000000", width: staticValue(0) },
        background: {
          enabled: false,
          color: "#000000",
          padding: 8,
          cornerRadius: 4,
        },
        maxWidth: null,
      },
    });

    const project = {
      ...base,
      entities: {
        ...base.entities,
        tracks: { [track.id]: track },
        clips: { [clip.id]: clip },
      },
      trackOrder: [track.id],
    };

    expect(JSON.parse(JSON.stringify(project))).toEqual(project);
  });
});

describe("createClip", () => {
  it("derives a readable default name per content kind", () => {
    const trackId = "track-1";
    const common = { trackId, startFrame: 0, durationFrames: 30 };

    const text = createClip({
      ...common,
      content: {
        kind: "text",
        text: "Subscribe now",
        fontFamily: "Inter",
        fontSize: staticValue(48),
        fontWeight: 600,
        italic: false,
        color: staticValue("#fff"),
        align: "left",
        lineHeight: 1.2,
        letterSpacing: staticValue(0),
        stroke: { enabled: false, color: "#000", width: staticValue(0) },
        background: { enabled: false, color: "#000", padding: 0, cornerRadius: 0 },
        maxWidth: null,
      },
    });
    expect(text.name).toBe("Subscribe now");

    const image = createClip({ ...common, content: { kind: "image", mediaId: "m1" } });
    expect(image.name).toBe("Image");
  });

  it("defaults to no grade, keeping saved documents small", () => {
    const clip = createClip({
      trackId: "t",
      startFrame: 0,
      durationFrames: 10,
      content: { kind: "image", mediaId: "m" },
    });

    expect(clip.grade).toBeNull();
  });
});

describe("createId", () => {
  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId()));
    expect(ids.size).toBe(500);
  });

  it("applies a prefix when given", () => {
    expect(createId("clip").startsWith("clip_")).toBe(true);
  });
});

describe("aspect ratios", () => {
  it("gives 16:9 a landscape 1920-wide resolution", () => {
    const size = resolutionForAspect(16 / 9);
    expect(size.width).toBe(1920);
    expect(size.height).toBe(1080);
  });

  it("gives 9:16 a portrait 1920-tall resolution", () => {
    const size = resolutionForAspect(9 / 16);
    expect(size.width).toBe(1080);
    expect(size.height).toBe(1920);
  });

  it("makes 1:1 square", () => {
    const size = resolutionForAspect(1);
    expect(size.width).toBe(size.height);
  });

  it("always produces even dimensions (codecs require it)", () => {
    for (const option of ASPECT_RATIOS) {
      const size = resolutionForAspect(option.ratio);
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
    }
  });

  it("round-trips a resolution back to its preset id", () => {
    expect(aspectForResolution({ width: 1920, height: 1080 })).toBe("16:9");
    expect(aspectForResolution({ width: 1080, height: 1920 })).toBe("9:16");
    expect(aspectForResolution({ width: 1000, height: 333 })).toBe("custom");
  });
});

import { describe, expect, it } from "vitest";
import type { ExportSettings, ProjectDocument } from "@cutaway/types";
import {
  ExportPlanError,
  describeExport,
  frameDurationMicros,
  frameTimestampMicros,
  planExport,
} from "../plan";

const settings = (over: Partial<ExportSettings> = {}): ExportSettings => ({
  format: "mp4",
  resolution: { width: 1920, height: 1080 },
  frameRate: 30,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  videoCodec: "h264",
  audioCodec: "aac",
  range: null,
  ...over,
});

const project = (durationFrames: number): ProjectDocument =>
  ({ durationFrames }) as unknown as ProjectDocument;

describe("planExport", () => {
  it("plans the full timeline when no range is set", () => {
    const plan = planExport(project(150), settings());
    expect(plan.startFrame).toBe(0);
    expect(plan.endFrame).toBe(150);
    expect(plan.totalFrames).toBe(150);
    expect(plan.durationSeconds).toBeCloseTo(5);
  });

  it("honours an explicit range", () => {
    const plan = planExport(project(300), settings({ range: { start: 30, end: 90 } }));
    expect(plan.totalFrames).toBe(60);
    expect(plan.durationSeconds).toBeCloseTo(2);
  });

  it("rejects an empty timeline", () => {
    expect(() => planExport(project(0), settings())).toThrow(ExportPlanError);
  });

  it("rejects a zero-length or inverted range", () => {
    expect(() => planExport(project(300), settings({ range: { start: 50, end: 50 } }))).toThrow(
      ExportPlanError,
    );
    expect(() => planExport(project(300), settings({ range: { start: 90, end: 30 } }))).toThrow(
      ExportPlanError,
    );
  });

  it("rejects odd dimensions that codecs cannot encode", () => {
    expect(() =>
      planExport(project(30), settings({ resolution: { width: 1921, height: 1080 } })),
    ).toThrow(/even/);
  });

  it("rejects a non-positive frame rate", () => {
    expect(() => planExport(project(30), settings({ frameRate: 0 }))).toThrow(ExportPlanError);
  });

  it("carries codec and bitrate settings into the plan", () => {
    const plan = planExport(project(30), settings({ videoCodec: "vp9", videoBitrate: 12_000_000 }));
    expect(plan.videoCodec).toBe("vp9");
    expect(plan.videoBitrate).toBe(12_000_000);
  });
});

describe("frame timing", () => {
  it("derives timestamps from the index so they never drift", () => {
    const plan = planExport(project(90), settings({ frameRate: 30 }));
    expect(frameTimestampMicros(plan, 0)).toBe(0);
    expect(frameTimestampMicros(plan, 30)).toBe(1_000_000);
    expect(frameTimestampMicros(plan, 90)).toBe(3_000_000);
  });

  it("computes a nominal frame duration", () => {
    const plan = planExport(project(90), settings({ frameRate: 25 }));
    expect(frameDurationMicros(plan)).toBe(40_000);
  });
});

describe("describeExport", () => {
  it("summarises size, rate, duration, and frame count", () => {
    const plan = planExport(project(150), settings());
    expect(describeExport(plan)).toBe("1920×1080 · 30 fps · 0:05 · 150 frames");
  });
});

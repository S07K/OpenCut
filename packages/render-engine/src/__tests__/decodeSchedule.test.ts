import { describe, expect, it } from "vitest";
import type { Clip, ProjectDocument, Track } from "@cutaway/types";
import { staticValue } from "@cutaway/types";
import { createClip, createProject, createTrack } from "@cutaway/utils";
import { planVideoDecodeSchedule } from "../decodeSchedule";
import { resolveScene } from "../scene";

function videoContent(mediaId = "m1", speed = 1, sourceInFrame = 0) {
  return {
    kind: "video" as const,
    mediaId,
    sourceInFrame,
    speed,
    volume: staticValue(1),
    muted: false,
  };
}

function imageContent(mediaId = "img1") {
  return { kind: "image" as const, mediaId };
}

function projectWith(tracks: Track[], clips: Clip[]): ProjectDocument {
  const base = createProject();
  return {
    ...base,
    entities: {
      ...base.entities,
      tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
      clips: Object.fromEntries(clips.map((c) => [c.id, c])),
    },
    trackOrder: tracks.map((t) => t.id),
  };
}

/** One video clip starting at frame 0, `durationFrames` long. */
function singleVideoProject(durationFrames = 5, speed = 1): ProjectDocument {
  const track = createTrack({ kind: "video", index: 0 });
  const clip = createClip({
    trackId: track.id,
    startFrame: 0,
    durationFrames,
    content: videoContent("m1", speed),
  });
  return projectWith([track], [clip]);
}

describe("planVideoDecodeSchedule", () => {
  it("records one timestamp per frame a video is on screen", () => {
    const schedule = planVideoDecodeSchedule(singleVideoProject(5), 0, 5);

    expect([...schedule.keys()]).toEqual(["m1"]);
    expect(schedule.get("m1")).toHaveLength(5);
  });

  it("matches exactly what the render loop asks resolveScene for", () => {
    // The schedule is only useful if it mirrors the loop request-for-request;
    // this pins that contract rather than re-deriving the timing maths.
    const project = singleVideoProject(5);
    const expected: number[] = [];
    for (let frame = 0; frame < 5; frame += 1) {
      for (const node of resolveScene(project, frame).nodes) {
        if (node.content.kind === "media" && node.content.mediaKind === "video") {
          expected.push(node.content.sourceTimeSeconds);
        }
      }
    }

    expect(planVideoDecodeSchedule(project, 0, 5).get("m1")).toEqual(expected);
  });

  it("honours the export range rather than the whole timeline", () => {
    const schedule = planVideoDecodeSchedule(singleVideoProject(10), 4, 7);
    expect(schedule.get("m1")).toHaveLength(3);
  });

  it("returns timestamps in ascending order for a normal clip", () => {
    const times = planVideoDecodeSchedule(singleVideoProject(6), 0, 6).get("m1")!;
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("advances faster than realtime when the clip is sped up", () => {
    const normal = planVideoDecodeSchedule(singleVideoProject(4, 1), 0, 4).get("m1")!;
    const fast = planVideoDecodeSchedule(singleVideoProject(4, 2), 0, 4).get("m1")!;
    expect(fast[3]).toBeGreaterThan(normal[3]!);
  });

  it("ignores images — only video is decoded frame by frame", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const clip = createClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 3,
      content: imageContent("img1"),
    });

    expect(planVideoDecodeSchedule(projectWith([track], [clip]), 0, 3).size).toBe(0);
  });

  it("keeps one entry per clip when a media is used twice at once", () => {
    // Two clips of the same source overlapping means two decode requests per
    // frame; collapsing them would desynchronise the puller.
    const track = createTrack({ kind: "video", index: 0 });
    const other = createTrack({ kind: "video", index: 1 });
    const clips = [track, other].map((t) =>
      createClip({
        trackId: t.id,
        startFrame: 0,
        durationFrames: 3,
        content: videoContent("m1"),
      }),
    );

    expect(
      planVideoDecodeSchedule(projectWith([track, other], clips), 0, 3).get("m1"),
    ).toHaveLength(6);
  });

  it("tracks each media separately", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const first = createClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 2,
      content: videoContent("m1"),
    });
    const second = createClip({
      trackId: track.id,
      startFrame: 2,
      durationFrames: 3,
      content: videoContent("m2"),
    });
    const schedule = planVideoDecodeSchedule(projectWith([track], [first, second]), 0, 5);

    expect(schedule.get("m1")).toHaveLength(2);
    expect(schedule.get("m2")).toHaveLength(3);
  });

  it("never schedules a negative timestamp", () => {
    // A clip trimmed to start before its source begins would otherwise ask for
    // a time no decoder can produce.
    const track = createTrack({ kind: "video", index: 0 });
    const clip = createClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 4,
      content: videoContent("m1", 1, -30),
    });
    const times = planVideoDecodeSchedule(projectWith([track], [clip]), 0, 4).get("m1")!;

    expect(times.every((t) => t >= 0)).toBe(true);
  });

  it("is empty for a range with no video", () => {
    expect(planVideoDecodeSchedule(createProject(), 0, 10).size).toBe(0);
  });
});

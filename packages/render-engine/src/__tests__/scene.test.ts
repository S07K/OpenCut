import { describe, expect, it } from "vitest";
import type { Clip, ProjectDocument, Track } from "@opencut/types";
import { staticValue } from "@opencut/types";
import { createClip, createProject, createTrack } from "@opencut/utils";
import { createEllipseMask } from "@opencut/mask-engine";
import { createColorGrade } from "@opencut/utils";
import { resolveScene, sourceTimeFor, transitionOpacity } from "../scene";

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

function audioContent(mediaId = "a1") {
  return {
    kind: "audio" as const,
    mediaId,
    sourceInFrame: 0,
    speed: 1,
    volume: staticValue(0.5),
    muted: false,
    fadeInFrames: 0,
    fadeOutFrames: 0,
  };
}

/** Builds a project from explicit tracks and clips. */
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

describe("resolveScene — captions", () => {
  function withCaption(): ProjectDocument {
    const base = createProject();
    return {
      ...base,
      entities: {
        ...base.entities,
        captionTracks: {
          ct1: {
            id: "ct1",
            sourceMediaId: null,
            language: "en",
            presetId: "core.captions.tiktok",
            blocks: [
              {
                id: "blk",
                styleOverrideId: null,
                startFrame: 0,
                endFrame: 30,
                words: [
                  { text: "hello", startFrame: 0, endFrame: 15, confidence: 1 },
                  { text: "world", startFrame: 15, endFrame: 30, confidence: 1 },
                ],
              },
            ],
          },
        },
      },
    };
  }

  it("resolves the active caption block with its preset", () => {
    const caption = resolveScene(withCaption(), 5).caption;
    expect(caption).not.toBeNull();
    expect(caption!.words.map((w) => w.text)).toEqual(["hello", "world"]);
    expect(caption!.preset.name).toBe("TikTok");
  });

  it("marks the word under the playhead active", () => {
    expect(resolveScene(withCaption(), 5).caption!.words.map((w) => w.active)).toEqual([
      true,
      false,
    ]);
    expect(resolveScene(withCaption(), 20).caption!.words.map((w) => w.active)).toEqual([
      false,
      true,
    ]);
  });

  it("is null when no block covers the frame", () => {
    expect(resolveScene(withCaption(), 100).caption).toBeNull();
  });

  it("is null with no caption tracks", () => {
    expect(resolveScene(createProject(), 0).caption).toBeNull();
  });
});

describe("resolveScene — colour grade", () => {
  function clipWithGrade(gradeOverride: (g: ReturnType<typeof createColorGrade>) => void): {
    track: Track;
    clip: Clip;
  } {
    const track = createTrack({ kind: "video", index: 0 });
    const grade = createColorGrade();
    grade.enabled = true;
    gradeOverride(grade);
    const clip: Clip = {
      ...createClip({
        trackId: track.id,
        startFrame: 0,
        durationFrames: 10,
        content: videoContent(),
      }),
      grade,
    };
    return { track, clip };
  }

  it("resolves an enabled, non-neutral grade onto the node", () => {
    const { track, clip } = clipWithGrade((g) => {
      g.contrast = staticValue(0.4);
    });
    const node = resolveScene(projectWith([track], [clip]), 5).nodes[0]!;
    expect(node.grade).not.toBeNull();
    expect(node.grade!.contrast).toBe(0.4);
  });

  it("is null for a disabled grade", () => {
    const { track, clip } = clipWithGrade((g) => {
      g.enabled = false;
      g.contrast = staticValue(0.4);
    });
    expect(resolveScene(projectWith([track], [clip]), 5).nodes[0]!.grade).toBeNull();
  });

  it("is null for an enabled but neutral grade, so the shader is skipped", () => {
    const { track, clip } = clipWithGrade(() => {});
    expect(resolveScene(projectWith([track], [clip]), 5).nodes[0]!.grade).toBeNull();
  });

  it("is null when the clip has no grade", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const clip = createClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
      content: videoContent(),
    });
    expect(resolveScene(projectWith([track], [clip]), 5).nodes[0]!.grade).toBeNull();
  });
});

describe("resolveScene — masks", () => {
  it("resolves a clip's enabled masks to geometry on the node", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const clip: Clip = {
      ...createClip({
        trackId: track.id,
        startFrame: 0,
        durationFrames: 10,
        content: videoContent(),
      }),
      masks: [createEllipseMask({ x: 0, y: 0 }, { x: 40, y: 40 })],
    };

    const node = resolveScene(projectWith([track], [clip]), 5).nodes[0]!;
    expect(node.masks).toHaveLength(1);
    expect(node.masks[0]!.polygon.length).toBeGreaterThan(3);
  });

  it("omits disabled masks", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const clip: Clip = {
      ...createClip({
        trackId: track.id,
        startFrame: 0,
        durationFrames: 10,
        content: videoContent(),
      }),
      masks: [{ ...createEllipseMask({ x: 0, y: 0 }, { x: 40, y: 40 }), enabled: false }],
    };

    expect(resolveScene(projectWith([track], [clip]), 5).nodes[0]!.masks).toHaveLength(0);
  });

  it("reports no masks for an unmasked clip", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const clip = createClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
      content: videoContent(),
    });
    expect(resolveScene(projectWith([track], [clip]), 5).nodes[0]!.masks).toEqual([]);
  });
});

describe("resolveScene", () => {
  it("includes only clips active at the frame", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const early = createClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
      content: videoContent(),
    });
    const late = createClip({
      trackId: track.id,
      startFrame: 50,
      durationFrames: 10,
      content: videoContent(),
    });

    const project = projectWith([track], [early, late]);

    expect(resolveScene(project, 5).nodes.map((n) => n.clipId)).toEqual([early.id]);
    expect(resolveScene(project, 55).nodes.map((n) => n.clipId)).toEqual([late.id]);
    expect(resolveScene(project, 30).nodes).toHaveLength(0);
  });

  it("treats the clip range as half-open", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const clip = createClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
      content: videoContent(),
    });
    const project = projectWith([track], [clip]);

    expect(resolveScene(project, 9).nodes).toHaveLength(1);
    // Frame 10 belongs to whatever comes next, not to this clip.
    expect(resolveScene(project, 10).nodes).toHaveLength(0);
  });

  it("draws the first track in order on top (top layer wins)", () => {
    // trackOrder is top-of-UI first; the first track is the foreground.
    const front = createTrack({ kind: "video", index: 0 });
    const back = createTrack({ kind: "overlay", index: 1 });

    // The front clip starts later; track order must still put it on top.
    const frontClip = createClip({
      trackId: front.id,
      startFrame: 5,
      durationFrames: 100,
      content: videoContent(),
    });
    const backClip = createClip({
      trackId: back.id,
      startFrame: 0,
      durationFrames: 100,
      content: videoContent(),
    });

    // Nodes come back in draw order (back to front), so the front-track clip
    // is last — drawn on top.
    const scene = resolveScene(projectWith([front, back], [frontClip, backClip]), 10);
    expect(scene.nodes.map((n) => n.clipId)).toEqual([backClip.id, frontClip.id]);
  });

  it("omits clips on hidden tracks and hidden clips", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const hiddenTrack: Track = { ...track, hidden: true };
    const clip = createClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
      content: videoContent(),
    });

    expect(resolveScene(projectWith([hiddenTrack], [clip]), 5).nodes).toHaveLength(0);
    expect(resolveScene(projectWith([track], [{ ...clip, hidden: true }]), 5).nodes).toHaveLength(
      0,
    );
  });

  it("collects audio separately from visual nodes", () => {
    const videoTrack = createTrack({ kind: "video", index: 0 });
    const audioTrack = createTrack({ kind: "audio", index: 1 });

    const clip = createClip({
      trackId: audioTrack.id,
      startFrame: 0,
      durationFrames: 100,
      content: audioContent(),
    });

    const scene = resolveScene(projectWith([videoTrack, audioTrack], [clip]), 10);
    expect(scene.nodes).toHaveLength(0);
    expect(scene.audio).toHaveLength(1);
    expect(scene.audio[0]!.mediaId).toBe("a1");
  });

  it("scales clip volume by track volume", () => {
    const audioTrack: Track = { ...createTrack({ kind: "audio", index: 0 }), volume: 0.5 };
    const clip = createClip({
      trackId: audioTrack.id,
      startFrame: 0,
      durationFrames: 100,
      content: audioContent(),
    });

    // Clip volume 0.5 * track volume 0.5.
    expect(resolveScene(projectWith([audioTrack], [clip]), 10).audio[0]!.volume).toBeCloseTo(0.25);
  });

  it("silences muted audio tracks", () => {
    const audioTrack: Track = { ...createTrack({ kind: "audio", index: 0 }), muted: true };
    const clip = createClip({
      trackId: audioTrack.id,
      startFrame: 0,
      durationFrames: 100,
      content: audioContent(),
    });

    expect(resolveScene(projectWith([audioTrack], [clip]), 10).audio).toHaveLength(0);
  });

  it("lets solo override mute on other tracks", () => {
    const soloed: Track = {
      ...createTrack({ kind: "audio", index: 0, name: "A" }),
      solo: true,
    };
    // Not muted, but must still be silenced because another track is soloed.
    const other = createTrack({ kind: "audio", index: 1, name: "B" });

    const soloClip = createClip({
      trackId: soloed.id,
      startFrame: 0,
      durationFrames: 100,
      content: audioContent("solo"),
    });
    const otherClip = createClip({
      trackId: other.id,
      startFrame: 0,
      durationFrames: 100,
      content: audioContent("other"),
    });

    const scene = resolveScene(projectWith([soloed, other], [soloClip, otherClip]), 10);
    expect(scene.audio.map((a) => a.mediaId)).toEqual(["solo"]);
  });

  it("resolves animated properties at the requested frame", () => {
    const track = createTrack({ kind: "video", index: 0 });
    const clip: Clip = {
      ...createClip({
        trackId: track.id,
        startFrame: 0,
        durationFrames: 100,
        content: videoContent(),
      }),
      appearance: {
        ...createClip({
          trackId: track.id,
          startFrame: 0,
          durationFrames: 100,
          content: videoContent(),
        }).appearance,
        opacity: {
          type: "animated",
          keyframes: [
            { frame: 0, value: 0, easing: { kind: "linear" } },
            { frame: 10, value: 1, easing: { kind: "linear" } },
          ],
        },
      },
    };

    const project = projectWith([track], [clip]);
    expect(resolveScene(project, 0).nodes[0]!.appearance.opacity).toBeCloseTo(0);
    expect(resolveScene(project, 5).nodes[0]!.appearance.opacity).toBeCloseTo(0.5);
    expect(resolveScene(project, 10).nodes[0]!.appearance.opacity).toBeCloseTo(1);
  });

  it("carries project resolution and background onto the scene", () => {
    const scene = resolveScene(createProject(), 0);
    expect(scene.resolution).toEqual({ width: 1920, height: 1080 });
    expect(scene.backgroundColor).toBe("#000000");
    expect(scene.frame).toBe(0);
  });
});

describe("sourceTimeFor", () => {
  const clip = createClip({
    trackId: "t",
    startFrame: 100,
    durationFrames: 100,
    content: videoContent(),
  });

  it("maps a timeline frame to source time", () => {
    // 30 frames into a clip that starts at source 0, at 30fps → 1 second.
    expect(sourceTimeFor(clip, 130, 0, 1, 30)).toBeCloseTo(1);
  });

  it("accounts for the source in-point", () => {
    expect(sourceTimeFor(clip, 100, 60, 1, 30)).toBeCloseTo(2);
  });

  it("consumes source faster at higher speed", () => {
    // At 2x, 30 timeline frames consume 60 source frames → 2 seconds.
    expect(sourceTimeFor(clip, 130, 0, 2, 30)).toBeCloseTo(2);
  });
});

describe("transitionOpacity", () => {
  const clip = (
    id: string,
    startFrame: number,
    durationFrames: number,
    transitionIn: Clip["transitionIn"] = null,
  ): Clip => ({
    ...createClip({ id, trackId: "t", startFrame, durationFrames, content: videoContent() }),
    transitionIn,
  });
  const cross = (durationFrames: number) => ({ kind: "crossfade" as const, durationFrames });
  const dip = (durationFrames: number) => ({ kind: "dip" as const, durationFrames });

  it("is 1 for a plain clip in its window and null outside", () => {
    const c = clip("a", 100, 50);
    expect(transitionOpacity(c, undefined, 120)).toBe(1);
    expect(transitionOpacity(c, undefined, 99)).toBeNull();
    expect(transitionOpacity(c, undefined, 150)).toBeNull();
  });

  it("fades the incoming clip in over the crossfade window", () => {
    const c = clip("b", 100, 50, cross(10));
    expect(transitionOpacity(c, undefined, 100)).toBe(0);
    expect(transitionOpacity(c, undefined, 105)).toBeCloseTo(0.5);
    expect(transitionOpacity(c, undefined, 110)).toBe(1); // past the fade
  });

  it("renders the outgoing clip's tail past its end, fading out", () => {
    const outgoing = clip("out", 50, 50); // ends at 100
    const incoming = clip("in", 100, 50, cross(10)); // adjacent cut at 100
    expect(transitionOpacity(outgoing, incoming, 100)).toBe(1);
    expect(transitionOpacity(outgoing, incoming, 105)).toBeCloseTo(0.5);
    expect(transitionOpacity(outgoing, incoming, 110)).toBeNull(); // tail over
  });

  it("only crossfades an exact cut, not a gap", () => {
    const outgoing = clip("out", 50, 50); // ends at 100
    const incoming = clip("in", 120, 50, cross(10)); // gap: starts at 120
    expect(transitionOpacity(outgoing, incoming, 105)).toBeNull();
  });

  it("routes a dip through black on both sides", () => {
    const outgoing = clip("out", 50, 50);
    const incoming = clip("in", 100, 50, dip(10));
    // Outgoing: full → black over the first half.
    expect(transitionOpacity(outgoing, incoming, 100)).toBe(1);
    expect(transitionOpacity(outgoing, incoming, 105)).toBe(0);
    // Incoming: black → full over the second half.
    expect(transitionOpacity(incoming, undefined, 105)).toBe(0);
    expect(transitionOpacity(incoming, undefined, 110)).toBe(1);
  });
});

describe("resolveScene — transitions", () => {
  it("shows both clips crossfading during the overlap", () => {
    const track = createTrack({ id: "vt", kind: "video", index: 0 });
    const outgoing = createClip({
      id: "out",
      trackId: track.id,
      startFrame: 0,
      durationFrames: 100,
      content: videoContent("mA"),
    });
    const incoming = {
      ...createClip({
        id: "in",
        trackId: track.id,
        startFrame: 100,
        durationFrames: 100,
        content: videoContent("mB"),
      }),
      transitionIn: { kind: "crossfade" as const, durationFrames: 20 },
    };

    // Halfway through the crossfade (frame 110): both visible near 0.5 opacity.
    const scene = resolveScene(projectWith([track], [outgoing, incoming]), 110);
    const byId = Object.fromEntries(scene.nodes.map((n) => [n.clipId, n.appearance.opacity]));
    expect(byId.out).toBeCloseTo(0.5);
    expect(byId.in).toBeCloseTo(0.5);
  });
});

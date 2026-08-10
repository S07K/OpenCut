import { describe, expect, it } from "vitest";
import type { AudioContent, Clip, ProjectDocument, Track } from "@opencut/types";
import { staticValue } from "@opencut/types";
import { createClip, createProject, createTrack } from "@opencut/utils";
import { resolveAudioTimeline } from "../audio";

function audioContent(over: Partial<AudioContent> = {}): AudioContent {
  return {
    kind: "audio",
    mediaId: "a1",
    sourceInFrame: 0,
    speed: 1,
    volume: staticValue(1),
    muted: false,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    ...over,
  };
}

function projectWith(tracks: Track[], clips: Clip[]): ProjectDocument {
  const base = createProject(); // 30 fps default
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

const audioTrack = (over: Partial<Track> = {}): Track => ({
  ...createTrack({ id: "at", kind: "audio", index: 0 }),
  ...over,
});

describe("resolveAudioTimeline", () => {
  it("places a clip in output time and reads from its source in-point", () => {
    const track = audioTrack();
    const clip = createClip({
      id: "c1",
      trackId: track.id,
      startFrame: 30, // 1s at 30fps
      durationFrames: 60, // 2s
      content: audioContent({ sourceInFrame: 15 }), // 0.5s into the source
    });

    const [resolved] = resolveAudioTimeline(projectWith([track], [clip]), 0, 300);

    expect(resolved).toMatchObject({
      mediaId: "a1",
      startSeconds: 1,
      durationSeconds: 2,
      sourceInSeconds: 0.5,
      gain: 1,
    });
  });

  it("multiplies clip volume by track volume for gain", () => {
    const track = audioTrack({ volume: 0.5 });
    const clip = createClip({
      id: "c1",
      trackId: track.id,
      startFrame: 0,
      durationFrames: 30,
      content: audioContent({ volume: staticValue(0.6) }),
    });

    expect(resolveAudioTimeline(projectWith([track], [clip]), 0, 300)[0]!.gain).toBeCloseTo(0.3);
  });

  it("clips the head and advances the source when exporting a sub-range", () => {
    const track = audioTrack();
    const clip = createClip({
      id: "c1",
      trackId: track.id,
      startFrame: 0,
      durationFrames: 120, // 4s
      content: audioContent({ sourceInFrame: 0, speed: 1 }),
    });

    // Export starts at frame 30 (1s) — the first second of the clip is skipped.
    const resolved = resolveAudioTimeline(projectWith([track], [clip]), 30, 90)[0]!;
    expect(resolved.startSeconds).toBe(0); // starts at the export's beginning
    expect(resolved.sourceInSeconds).toBe(1); // 1s already consumed
    expect(resolved.durationSeconds).toBe(2); // frames 30..90 → 2s
  });

  it("advances the source faster than real time when sped up", () => {
    const track = audioTrack();
    const clip = createClip({
      id: "c1",
      trackId: track.id,
      startFrame: 0,
      durationFrames: 120,
      content: audioContent({ sourceInFrame: 0, speed: 2 }),
    });

    // Skipping 30 output frames at 2× consumes 60 source frames = 2s.
    expect(resolveAudioTimeline(projectWith([track], [clip]), 30, 90)[0]!.sourceInSeconds).toBe(2);
  });

  it("excludes muted clips, muted tracks, and hidden clips", () => {
    const track = audioTrack();
    const base = { trackId: track.id, startFrame: 0, durationFrames: 30 };
    const clips = [
      createClip({ id: "muted-clip", ...base, content: audioContent({ muted: true }) }),
      { ...createClip({ id: "hidden", ...base, content: audioContent() }), hidden: true },
    ];
    expect(resolveAudioTimeline(projectWith([track], clips), 0, 300)).toHaveLength(0);

    const mutedTrack = audioTrack({ muted: true });
    const onMuted = createClip({
      ...base,
      id: "c",
      trackId: mutedTrack.id,
      content: audioContent(),
    });
    expect(resolveAudioTimeline(projectWith([mutedTrack], [onMuted]), 0, 300)).toHaveLength(0);
  });

  it("silences non-soloed tracks when any audio track is soloed", () => {
    const soloed = audioTrack({ id: "solo", index: 0, solo: true });
    const other = audioTrack({ id: "other", index: 1 });
    const base = { startFrame: 0, durationFrames: 30 };
    const clips = [
      createClip({ id: "on-solo", trackId: soloed.id, ...base, content: audioContent() }),
      createClip({ id: "on-other", trackId: other.id, ...base, content: audioContent() }),
    ];

    const resolved = resolveAudioTimeline(projectWith([soloed, other], clips), 0, 300);
    expect(resolved.map((r) => r.clipId)).toEqual(["on-solo"]);
  });

  it("ignores clips entirely outside the export range", () => {
    const track = audioTrack();
    const clip = createClip({
      id: "c1",
      trackId: track.id,
      startFrame: 200,
      durationFrames: 30,
      content: audioContent(),
    });
    expect(resolveAudioTimeline(projectWith([track], [clip]), 0, 100)).toHaveLength(0);
  });

  it("carries fade durations through in seconds", () => {
    const track = audioTrack();
    const clip = createClip({
      id: "c1",
      trackId: track.id,
      startFrame: 0,
      durationFrames: 60,
      content: audioContent({ fadeInFrames: 15, fadeOutFrames: 30 }),
    });
    const resolved = resolveAudioTimeline(projectWith([track], [clip]), 0, 300)[0]!;
    expect(resolved.fadeInSeconds).toBe(0.5);
    expect(resolved.fadeOutSeconds).toBe(1);
  });
});

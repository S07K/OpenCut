import { describe, expect, it } from "vitest";
import type {
  AudioContent,
  Clip,
  MediaAsset,
  ProjectDocument,
  Track,
  VideoContent,
} from "@cutaway/types";
import { staticValue } from "@cutaway/types";
import { createClip, createProject, createTrack } from "@cutaway/utils";
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

function videoContent(over: Partial<VideoContent> = {}): VideoContent {
  return {
    kind: "video",
    mediaId: "v1",
    sourceInFrame: 0,
    speed: 1,
    volume: staticValue(1),
    muted: false,
    ...over,
  };
}

/** A minimal MediaAsset carrying only the audio-relevant metadata the resolver reads. */
function media(id: string, hasAudio: boolean): MediaAsset {
  return {
    id,
    metadata: { hasAudio },
  } as unknown as MediaAsset;
}

function projectWith(
  tracks: Track[],
  clips: Clip[],
  mediaAssets: MediaAsset[] = [],
): ProjectDocument {
  const base = createProject(); // 30 fps default
  return {
    ...base,
    entities: {
      ...base.entities,
      tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
      clips: Object.fromEntries(clips.map((c) => [c.id, c])),
      media: Object.fromEntries(mediaAssets.map((m) => [m.id, m])),
    },
    trackOrder: tracks.map((t) => t.id),
  };
}

const audioTrack = (over: Partial<Track> = {}): Track => ({
  ...createTrack({ id: "at", kind: "audio", index: 0 }),
  ...over,
});

const videoTrack = (over: Partial<Track> = {}): Track => ({
  ...createTrack({ id: "vt", kind: "video", index: 0 }),
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

describe("resolveAudioTimeline — video clips", () => {
  it("includes a video clip's embedded audio when the media has an audio stream", () => {
    const track = videoTrack();
    const clip = createClip({
      id: "v",
      trackId: track.id,
      startFrame: 30,
      durationFrames: 60,
      content: videoContent({ mediaId: "v1", volume: staticValue(0.8) }),
    });

    const [resolved] = resolveAudioTimeline(
      projectWith([track], [clip], [media("v1", true)]),
      0,
      300,
    );
    expect(resolved).toMatchObject({
      mediaId: "v1",
      startSeconds: 1,
      durationSeconds: 2,
      gain: 0.8,
    });
  });

  it("excludes a silent video (media without an audio stream)", () => {
    const track = videoTrack();
    const clip = createClip({
      id: "v",
      trackId: track.id,
      startFrame: 0,
      durationFrames: 30,
      content: videoContent({ mediaId: "v1" }),
    });
    expect(
      resolveAudioTimeline(projectWith([track], [clip], [media("v1", false)]), 0, 300),
    ).toHaveLength(0);
  });

  it("excludes a video clip whose own audio is muted, or whose track is muted", () => {
    const track = videoTrack();
    const mutedClip = createClip({
      id: "v1c",
      trackId: track.id,
      startFrame: 0,
      durationFrames: 30,
      content: videoContent({ mediaId: "v1", muted: true }),
    });
    expect(
      resolveAudioTimeline(projectWith([track], [mutedClip], [media("v1", true)]), 0, 300),
    ).toHaveLength(0);

    const mutedTrack = videoTrack({ muted: true });
    const clip = createClip({
      id: "v2c",
      trackId: mutedTrack.id,
      startFrame: 0,
      durationFrames: 30,
      content: videoContent({ mediaId: "v1" }),
    });
    expect(
      resolveAudioTimeline(projectWith([mutedTrack], [clip], [media("v1", true)]), 0, 300),
    ).toHaveLength(0);
  });

  it("silences video-clip audio when an audio track is soloed", () => {
    const vTrack = videoTrack({ id: "vt", index: 0 });
    const aTrack = audioTrack({ id: "at", index: 1, solo: true });
    const vClip = createClip({
      id: "v",
      trackId: vTrack.id,
      startFrame: 0,
      durationFrames: 30,
      content: videoContent({ mediaId: "v1" }),
    });
    const aClip = createClip({
      id: "a",
      trackId: aTrack.id,
      startFrame: 0,
      durationFrames: 30,
      content: audioContent(),
    });

    const resolved = resolveAudioTimeline(
      projectWith([vTrack, aTrack], [vClip, aClip], [media("v1", true)]),
      0,
      300,
    );
    expect(resolved.map((r) => r.clipId)).toEqual(["a"]);
  });

  it("mixes audio-track and video-track audio together when both are audible", () => {
    const vTrack = videoTrack({ id: "vt", index: 0 });
    const aTrack = audioTrack({ id: "at", index: 1 });
    const vClip = createClip({
      id: "v",
      trackId: vTrack.id,
      startFrame: 0,
      durationFrames: 30,
      content: videoContent({ mediaId: "v1" }),
    });
    const aClip = createClip({
      id: "a",
      trackId: aTrack.id,
      startFrame: 0,
      durationFrames: 30,
      content: audioContent(),
    });

    const resolved = resolveAudioTimeline(
      projectWith([vTrack, aTrack], [vClip, aClip], [media("v1", true)]),
      0,
      300,
    );
    expect(resolved.map((r) => r.clipId).sort()).toEqual(["a", "v"]);
  });
});

import type { ProjectDocument } from "@opencut/types";
import { staticValue } from "@opencut/types";
import { createClip, createProject, createTrack } from "@opencut/utils";

/**
 * A small demo project, so `pnpm dev` opens onto a working editor rather than
 * an empty grid.
 *
 * This is scaffolding for Phase 1 only — once media import lands, the editor
 * opens on a genuinely empty project and this is deleted.
 */
export function createDemoProject(): ProjectDocument {
  const project = createProject("Demo Project");

  const videoTrack = createTrack({ kind: "video", index: 0, name: "Video 1" });
  const overlayTrack = createTrack({ kind: "overlay", index: 1, name: "Overlay" });
  const audioTrack = createTrack({ kind: "audio", index: 2, name: "Audio 1" });

  const clips = [
    createClip({
      trackId: videoTrack.id,
      name: "Intro",
      startFrame: 0,
      durationFrames: 90,
      content: {
        kind: "video",
        mediaId: "demo-media",
        sourceInFrame: 0,
        speed: 1,
        volume: staticValue(1),
        muted: false,
      },
    }),
    createClip({
      trackId: videoTrack.id,
      name: "B-Roll",
      startFrame: 96,
      durationFrames: 150,
      content: {
        kind: "video",
        mediaId: "demo-media",
        sourceInFrame: 0,
        speed: 1,
        volume: staticValue(1),
        muted: false,
      },
    }),
    createClip({
      trackId: overlayTrack.id,
      startFrame: 30,
      durationFrames: 72,
      content: {
        kind: "text",
        text: "Hook goes here",
        fontFamily: "Inter",
        fontSize: staticValue(96),
        fontWeight: 800,
        italic: false,
        color: staticValue("#ffffff"),
        align: "center",
        lineHeight: 1.1,
        letterSpacing: staticValue(-2),
        stroke: { enabled: true, color: "#000000", width: staticValue(6) },
        background: {
          enabled: false,
          color: "#000000",
          padding: 16,
          cornerRadius: 8,
        },
        maxWidth: 1400,
      },
    }),
    createClip({
      trackId: audioTrack.id,
      name: "Music Bed",
      startFrame: 0,
      durationFrames: 246,
      content: {
        kind: "audio",
        mediaId: "demo-audio",
        sourceInFrame: 0,
        speed: 1,
        volume: staticValue(0.6),
        muted: false,
        fadeInFrames: 15,
        fadeOutFrames: 30,
      },
    }),
  ];

  const tracks = [videoTrack, overlayTrack, audioTrack];

  return {
    ...project,
    entities: {
      ...project.entities,
      tracks: Object.fromEntries(tracks.map((track) => [track.id, track])),
      clips: Object.fromEntries(clips.map((clip) => [clip.id, clip])),
    },
    trackOrder: tracks.map((track) => track.id),
    durationFrames: 246,
  };
}

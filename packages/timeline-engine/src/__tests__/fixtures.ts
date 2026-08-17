import type { Clip, VideoContent } from "@opencut/types";
import { staticValue } from "@opencut/types";

/** Builds a minimal but *valid* clip. Tests override only what they care about. */
export function makeClip(overrides: Partial<Clip> = {}): Clip {
  const content: VideoContent = {
    kind: "video",
    mediaId: "media-1",
    sourceInFrame: 0,
    speed: 1,
    volume: staticValue(1),
    muted: false,
  };

  return {
    id: "clip-1",
    name: "Clip",
    trackId: "track-1",
    startFrame: 0,
    durationFrames: 100,
    content,
    transform: {
      position: staticValue({ x: 0, y: 0 }),
      scale: staticValue({ x: 1, y: 1 }),
      rotation: staticValue(0),
      anchor: staticValue({ x: 0.5, y: 0.5 }),
      skew: staticValue({ x: 0, y: 0 }),
    },
    appearance: {
      opacity: staticValue(1),
      blur: staticValue(0),
      cornerRadius: staticValue(0),
      shadow: {
        enabled: false,
        color: staticValue("#000000"),
        offset: staticValue({ x: 0, y: 0 }),
        blur: staticValue(0),
        opacity: staticValue(1),
      },
      crop: staticValue({ top: 0, right: 0, bottom: 0, left: 0 }),
      blendMode: "normal",
    },
    masks: [],
    effects: [],
    grade: null,
    transitionIn: null,
    locked: false,
    hidden: false,
    groupId: null,
    ...overrides,
  };
}

import type { CaptionTrackData } from "@opencut/types";

/** The store's caption-track updater, threaded to the editor components. */
export type EditorUpdateCaptionTrack = (
  trackId: string,
  updater: (track: CaptionTrackData) => CaptionTrackData,
  label: string,
  mergeKey?: string,
) => void;

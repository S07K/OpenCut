/**
 * Frame/time conversion.
 *
 * All timeline math is integer-frame math. These helpers are the *only*
 * sanctioned boundary between frames and seconds; converting ad hoc elsewhere
 * is how one-frame drift creeps in.
 */

import type { Frame } from "@opencut/types";

export function framesToSeconds(frames: Frame, fps: number): number {
  return frames / fps;
}

/**
 * Converts seconds to the nearest frame.
 *
 * Rounds rather than truncates: truncation biases every conversion downward,
 * which accumulates visibly when the playhead round-trips through seconds on
 * each animation frame.
 */
export function secondsToFrames(seconds: number, fps: number): Frame {
  return Math.round(seconds * fps);
}

/** Formats a frame as `HH:MM:SS:FF`, the timecode creators expect. */
export function formatTimecode(frame: Frame, fps: number): string {
  const safeFrame = Math.max(0, Math.floor(frame));
  const totalSeconds = Math.floor(safeFrame / fps);
  const frames = safeFrame % fps;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** Formats a frame as `M:SS`, for compact UI like clip labels. */
export function formatDuration(frame: Frame, fps: number): string {
  const totalSeconds = Math.floor(Math.max(0, frame) / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

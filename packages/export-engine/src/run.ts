/**
 * The export orchestrator — the pure control flow that ties a frame source to a
 * video writer.
 *
 * It owns the loop, the timestamps, progress reporting, cancellation, and
 * cleanup; it owns none of the rendering or encoding. Because it only talks to
 * the two interfaces, the whole export lifecycle — including "cancel halfway"
 * and "the encoder threw" — is exercised in tests with trivial fakes, no
 * browser required.
 */

import { frameDurationMicros, frameTimestampMicros, type ExportPlan } from "./plan";
import { exportProgress, type ExportProgress } from "./progress";
import type { FrameReleaser, FrameSource, VideoWriter } from "./providers";

/** Raised when an export is aborted through its `AbortSignal`. */
export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled.");
    this.name = "ExportCancelledError";
  }
}

export interface RunVideoExportOptions<TFrame> {
  plan: ExportPlan;
  frameSource: FrameSource<TFrame>;
  videoWriter: VideoWriter<TFrame>;
  /**
   * Releases a frame after it has been encoded. Defaults to calling `close()` if
   * the frame has one (the `VideoFrame` case), so callers rarely pass it.
   */
  releaseFrame?: FrameReleaser<TFrame>;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Renders every frame in the plan and encodes it, returning the finished file
 * bytes. Throws {@link ExportCancelledError} if the signal aborts, and always
 * disposes the source and writer — including on error — so a failed or
 * cancelled export never leaks an encoder or a decoder.
 */
export async function runVideoExport<TFrame>(
  options: RunVideoExportOptions<TFrame>,
): Promise<Uint8Array> {
  const { plan, frameSource, videoWriter, signal, onProgress } = options;
  const release = options.releaseFrame ?? defaultRelease;
  const frameDuration = frameDurationMicros(plan);

  const report = (phase: Parameters<typeof exportProgress>[0], completed: number) =>
    onProgress?.(exportProgress(phase, completed, plan.totalFrames));

  try {
    throwIfAborted(signal);
    report("preparing", 0);

    for (let i = 0; i < plan.totalFrames; i++) {
      throwIfAborted(signal);

      const timelineFrame = plan.startFrame + i;
      const frame = await frameSource.renderFrame(timelineFrame);

      // The frame must be released even if encoding throws, so it is the
      // writer's turn inside its own try — otherwise a mid-export encoder error
      // would leak the last decoded frame.
      try {
        await videoWriter.addFrame(frame, frameTimestampMicros(plan, i), frameDuration);
      } finally {
        release(frame);
      }

      report("rendering", i + 1);
    }

    throwIfAborted(signal);
    report("finalizing", plan.totalFrames);
    const bytes = await videoWriter.finalize();

    report("done", plan.totalFrames);
    return bytes;
  } finally {
    // Dispose in a fixed order regardless of how we got here.
    await safeDispose(frameSource);
    await safeDispose(videoWriter);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ExportCancelledError();
}

/** Closes a frame if it exposes `close()` (the WebCodecs `VideoFrame` shape). */
function defaultRelease<TFrame>(frame: TFrame): void {
  const closable = frame as { close?: () => void };
  if (typeof closable?.close === "function") closable.close();
}

async function safeDispose(target: { dispose?: () => Promise<void> | void }): Promise<void> {
  try {
    await target.dispose?.();
  } catch {
    // A cleanup failure must not mask the real outcome (success or the original
    // error); the resources are being discarded regardless.
  }
}

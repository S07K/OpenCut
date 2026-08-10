/**
 * The export progress model.
 *
 * One shape reported throughout a job so the UI can render a single bar with a
 * phase label. `ratio` is the headline number; the frame counts let the UI show
 * "142 / 300" without recomputing.
 */

export type ExportPhase =
  /** Setting up encoders and the frame source; no frames done yet. */
  | "preparing"
  /** Rendering and encoding frames — the long phase. */
  | "rendering"
  /** Flushing the encoder and writing the container. */
  | "finalizing"
  /** The output is ready. */
  | "done";

export interface ExportProgress {
  phase: ExportPhase;
  /** Frames encoded so far. */
  completedFrames: number;
  totalFrames: number;
  /** Overall completion in [0, 1], monotonic across the whole job. */
  ratio: number;
}

/** Builds a progress record with a clamped, well-defined ratio. */
export function exportProgress(
  phase: ExportPhase,
  completedFrames: number,
  totalFrames: number,
): ExportProgress {
  const ratio =
    phase === "done"
      ? 1
      : totalFrames <= 0
        ? 0
        : Math.min(1, Math.max(0, completedFrames / totalFrames));
  return { phase, completedFrames, totalFrames, ratio };
}

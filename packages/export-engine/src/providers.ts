/**
 * The seams between the pure orchestrator and the browser backends.
 *
 * The engine has no DOM lib, so it never names `VideoFrame`, `canvas`, or a
 * muxer. Instead it is generic over an opaque frame type `TFrame`: the adapter
 * that renders (Pixi → canvas → VideoFrame) and the adapter that encodes
 * (WebCodecs + muxer) both bind `TFrame` to the same concrete type, and the
 * orchestrator just moves frames from one to the other. This is what keeps the
 * export loop unit-testable with plain fakes.
 */

/** Produces the composited frame for a given timeline frame number. */
export interface FrameSource<TFrame> {
  /**
   * Renders `frame` (a timeline frame index) and returns it as `TFrame`.
   * Ownership passes to the caller, which is responsible for releasing it after
   * encoding — important for `VideoFrame`, which must be `close()`d.
   */
  renderFrame(frame: number): Promise<TFrame>;
  /** Releases any resources held for rendering (textures, canvases, decoders). */
  dispose?(): Promise<void> | void;
}

/** Consumes rendered frames and produces the final container bytes. */
export interface VideoWriter<TFrame> {
  /**
   * Encodes one frame at the given presentation timestamp. Both times are in
   * microseconds. The writer does not take permanent ownership — the caller
   * releases the frame after this resolves.
   */
  addFrame(frame: TFrame, timestampMicros: number, durationMicros: number): Promise<void> | void;
  /** Flushes the encoder and returns the finished file bytes. */
  finalize(): Promise<Uint8Array>;
  /** Releases encoder/muxer resources on failure or cancellation. */
  dispose?(): Promise<void> | void;
}

/** How the caller releases a frame once the writer has consumed it. */
export type FrameReleaser<TFrame> = (frame: TFrame) => void;

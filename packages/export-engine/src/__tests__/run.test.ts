import { describe, expect, it, vi } from "vitest";
import type { ExportSettings, ProjectDocument } from "@opencut/types";
import { planExport, type ExportPlan } from "../plan";
import type { ExportProgress } from "../progress";
import type { FrameSource, VideoWriter } from "../providers";
import { ExportCancelledError, runVideoExport } from "../run";

const plan = (totalFrames: number, frameRate = 30): ExportPlan =>
  planExport(
    { durationFrames: totalFrames } as unknown as ProjectDocument,
    {
      format: "mp4",
      resolution: { width: 640, height: 480 },
      frameRate,
      videoBitrate: 1_000_000,
      audioBitrate: 128_000,
      videoCodec: "h264",
      audioCodec: "aac",
      range: null,
    } as ExportSettings,
  );

/** A frame is just its timeline index here, with a close() spy to prove release. */
interface FakeFrame {
  frame: number;
  close: () => void;
}

function fakeSource(): FrameSource<FakeFrame> {
  return {
    renderFrame: vi.fn(async (frame: number) => ({ frame, close: vi.fn() })),
    dispose: vi.fn(),
  };
}

function fakeWriter(): VideoWriter<FakeFrame> & { frames: { frame: number; ts: number }[] } {
  const frames: { frame: number; ts: number }[] = [];
  return {
    frames,
    addFrame: vi.fn(async (f: FakeFrame, ts: number) => {
      frames.push({ frame: f.frame, ts });
    }),
    finalize: vi.fn(async () => new Uint8Array([1, 2, 3])),
    dispose: vi.fn(),
  };
}

describe("runVideoExport", () => {
  it("renders every frame in order and returns the finalized bytes", async () => {
    const source = fakeSource();
    const writer = fakeWriter();

    const bytes = await runVideoExport({ plan: plan(4), frameSource: source, videoWriter: writer });

    expect(writer.frames.map((f) => f.frame)).toEqual([0, 1, 2, 3]);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(writer.dispose).toHaveBeenCalledOnce();
  });

  it("stamps monotonic timestamps derived from the frame rate", async () => {
    const writer = fakeWriter();
    await runVideoExport({ plan: plan(3, 30), frameSource: fakeSource(), videoWriter: writer });
    expect(writer.frames.map((f) => f.ts)).toEqual([0, 33_333, 66_667]);
  });

  it("offsets timestamps to zero when exporting a sub-range", async () => {
    const p = planExport(
      { durationFrames: 300 } as unknown as ProjectDocument,
      {
        format: "mp4",
        resolution: { width: 640, height: 480 },
        frameRate: 30,
        videoBitrate: 1_000_000,
        audioBitrate: 128_000,
        videoCodec: "h264",
        audioCodec: "aac",
        range: { start: 60, end: 63 },
      } as ExportSettings,
    );
    const source = fakeSource();
    const writer = fakeWriter();

    await runVideoExport({ plan: p, frameSource: source, videoWriter: writer });

    // Rendered the timeline frames from the range…
    expect((source.renderFrame as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      60, 61, 62,
    ]);
    // …but the output starts at t=0.
    expect(writer.frames[0]!.ts).toBe(0);
  });

  it("reports progress through the phases ending at ratio 1", async () => {
    const events: ExportProgress[] = [];
    await runVideoExport({
      plan: plan(2),
      frameSource: fakeSource(),
      videoWriter: fakeWriter(),
      onProgress: (p) => events.push(p),
    });

    expect(events[0]!.phase).toBe("preparing");
    expect(events.some((e) => e.phase === "rendering")).toBe(true);
    expect(events.some((e) => e.phase === "finalizing")).toBe(true);
    const last = events.at(-1)!;
    expect(last.phase).toBe("done");
    expect(last.ratio).toBe(1);
  });

  it("releases every frame it renders", async () => {
    const closes: ReturnType<typeof vi.fn>[] = [];
    const source: FrameSource<FakeFrame> = {
      renderFrame: async (frame) => {
        const close = vi.fn();
        closes.push(close);
        return { frame, close };
      },
    };
    await runVideoExport({ plan: plan(3), frameSource: source, videoWriter: fakeWriter() });
    expect(closes).toHaveLength(3);
    expect(closes.every((c) => c.mock.calls.length === 1)).toBe(true);
  });

  it("aborts before rendering when the signal is already aborted", async () => {
    const source = fakeSource();
    await expect(
      runVideoExport({
        plan: plan(5),
        frameSource: source,
        videoWriter: fakeWriter(),
        signal: AbortSignal.abort(),
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError);
    expect(source.renderFrame).not.toHaveBeenCalled();
    expect(source.dispose).toHaveBeenCalledOnce();
  });

  it("stops mid-export when cancelled and still disposes", async () => {
    const controller = new AbortController();
    const writer = fakeWriter();
    const source: FrameSource<FakeFrame> = {
      renderFrame: vi.fn(async (frame: number) => {
        if (frame === 2) controller.abort();
        return { frame, close: vi.fn() };
      }),
      dispose: vi.fn(),
    };

    await expect(
      runVideoExport({
        plan: plan(10),
        frameSource: source,
        videoWriter: writer,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError);

    // Frames 0,1,2 encoded before the abort was observed at the top of frame 3.
    expect(writer.frames.map((f) => f.frame)).toEqual([0, 1, 2]);
    expect(writer.finalize).not.toHaveBeenCalled();
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(writer.dispose).toHaveBeenCalledOnce();
  });

  it("releases the frame and disposes when the writer throws", async () => {
    const close = vi.fn();
    const source: FrameSource<FakeFrame> = {
      renderFrame: async (frame) => ({ frame, close }),
      dispose: vi.fn(),
    };
    const writer: VideoWriter<FakeFrame> = {
      addFrame: async () => {
        throw new Error("encoder blew up");
      },
      finalize: async () => new Uint8Array(),
      dispose: vi.fn(),
    };

    await expect(
      runVideoExport({ plan: plan(3), frameSource: source, videoWriter: writer }),
    ).rejects.toThrow("encoder blew up");
    expect(close).toHaveBeenCalledOnce();
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(writer.dispose).toHaveBeenCalledOnce();
  });
});

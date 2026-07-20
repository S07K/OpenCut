import { describe, expect, it } from "vitest";
import { formatDuration, formatTimecode, framesToSeconds, secondsToFrames } from "../time.js";

describe("frame/second conversion", () => {
  it("round-trips without drift", () => {
    for (const fps of [24, 25, 30, 60]) {
      for (const frame of [0, 1, 47, 1000, 99999]) {
        expect(secondsToFrames(framesToSeconds(frame, fps), fps)).toBe(frame);
      }
    }
  });

  it("rounds rather than truncates", () => {
    // 0.999 of a frame is far closer to frame 1 than to frame 0.
    expect(secondsToFrames(0.999 / 30, 30)).toBe(1);
  });
});

describe("formatTimecode", () => {
  it("renders HH:MM:SS:FF", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(29, 30)).toBe("00:00:00:29");
    expect(formatTimecode(30, 30)).toBe("00:00:01:00");
    expect(formatTimecode(30 * 61, 30)).toBe("00:01:01:00");
    expect(formatTimecode(30 * 3661, 30)).toBe("01:01:01:00");
  });

  it("clamps negative frames to zero", () => {
    expect(formatTimecode(-5, 30)).toBe("00:00:00:00");
  });
});

describe("formatDuration", () => {
  it("renders M:SS", () => {
    expect(formatDuration(0, 30)).toBe("0:00");
    expect(formatDuration(30 * 75, 30)).toBe("1:15");
  });
});

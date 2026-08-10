import { describe, expect, it } from "vitest";
import { audioCodecString, videoCodecString } from "../codec";

describe("videoCodecString", () => {
  it("picks an H.264 level that fits the resolution", () => {
    expect(videoCodecString("h264", { width: 1280, height: 720 })).toBe("avc1.42001f"); // 3.1
    expect(videoCodecString("h264", { width: 1920, height: 1080 })).toBe("avc1.420028"); // 4.0
    expect(videoCodecString("h264", { width: 3840, height: 2160 })).toBe("avc1.420033"); // 5.1
  });

  it("maps the other video codecs to WebCodecs strings", () => {
    expect(videoCodecString("vp9", { width: 1920, height: 1080 })).toMatch(/^vp09/);
    expect(videoCodecString("av1", { width: 1920, height: 1080 })).toMatch(/^av01/);
    expect(videoCodecString("none", { width: 1920, height: 1080 })).toBeNull();
  });
});

describe("audioCodecString", () => {
  it("maps audio codecs to WebCodecs strings", () => {
    expect(audioCodecString("aac")).toBe("mp4a.40.2");
    expect(audioCodecString("opus")).toBe("opus");
    expect(audioCodecString("none")).toBeNull();
  });
});

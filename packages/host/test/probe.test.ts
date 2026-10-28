import { describe, expect, it } from "vitest";
import { parseFfprobe } from "../src/probe";
import { validateMediaPath, validateProjectPath } from "../src/paths";

const sample = {
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30000/1001", avg_frame_rate: "30000/1001" },
    { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
    { index: 2, codec_type: "audio", codec_name: "aac", channels: 1, sample_rate: "44100" },
  ],
  format: { duration: "12.512000" },
};

describe("parseFfprobe", () => {
  it("extracts duration, size, rational fps and audio streams", () => {
    const p = parseFfprobe(sample, "C:\\v\\a.mp4");
    expect(p).toMatchObject({ durationSec: 12.512, width: 1920, height: 1080, fps: { num: 30000, den: 1001 }, name: "a.mp4" });
    expect(p.audioStreams).toEqual([
      { index: 1, codec: "aac", channels: 2, sampleRate: 48000 },
      { index: 2, codec: "aac", channels: 1, sampleRate: 44100 },
    ]);
  });
  it("rejects audio-only files and missing durations", () => {
    expect(() => parseFfprobe({ streams: [sample.streams[1]!], format: { duration: "3" } }, "x")).toThrow(/no video/);
    expect(() => parseFfprobe({ streams: [sample.streams[0]!], format: {} }, "x")).toThrow(/duration/);
  });
  it("ignores cover-art pseudo video streams", () => {
    const art = { index: 0, codec_type: "video", width: 5, height: 5, r_frame_rate: "25/1", disposition: { attached_pic: 1 } };
    expect(() => parseFfprobe({ streams: [art], format: { duration: "3" } }, "x")).toThrow(/no video/);
  });
});

describe("path validation", () => {
  it("rejects hostile project and media paths", async () => {
    await expect(validateMediaPath("a.mp4")).rejects.toThrow(/absolute/);
    await expect(validateMediaPath("C:\\x\\..\\y.mp4")).rejects.toThrow(/\.\./);
    await expect(validateMediaPath("\\\\?\\C:\\y.mp4")).rejects.toThrow(/UNC/);
    await expect(validateMediaPath("C:\\y\0.mp4")).rejects.toThrow(/NUL/);
    await expect(validateMediaPath(42)).rejects.toThrow(/string/);
    await expect(validateProjectPath("C:\\p.json", "save", [])).rejects.toThrow(/must end with/);
  });
});

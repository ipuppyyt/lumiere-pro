import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffprobeProbe } from "../src/probe";

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync(process.env.CE_FFPROBE ?? "ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasFfmpeg())("real ffprobe", () => {
  it("probes a generated 6 s, 30 fps, 640x360 file with one audio stream", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ce-ff-"));
    const file = path.join(dir, "gen.mp4");
    try {
      execFileSync(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=6:size=640x360:rate=30",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file],
        { stdio: "ignore" },
      );
      const p = await ffprobeProbe()(file);
      expect(p).toMatchObject({ width: 640, height: 360, fps: { num: 30, den: 1 }, hasVideo: true });
      expect(p.durationSec).toBeCloseTo(6, 1);
      expect(p.audioStreams).toHaveLength(1);
      expect(p.audioStreams[0]).toMatchObject({ codec: "aac", channels: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

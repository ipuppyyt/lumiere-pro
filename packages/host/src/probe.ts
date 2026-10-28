import { execFile } from "node:child_process";
import path from "node:path";
import { EditError, type MediaProbe } from "@lumiere-pro/core";

interface FfStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
}
export interface FfprobeJson {
  streams?: FfStream[];
  format?: { duration?: string };
}

export type ProbeFn = (realPath: string) => Promise<MediaProbe>;

function parseRate(s: string | undefined): { num: number; den: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(s ?? "");
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  return num > 0 && den > 0 ? { num, den } : null;
}

/** Pure: turns ffprobe's JSON into a MediaProbe. Rejects files without a video stream. */
export function parseFfprobe(json: FfprobeJson, realPath: string): MediaProbe {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video) throw new EditError("PROBE_FAILED", "File has no video stream");
  const fps = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate);
  if (!fps) throw new EditError("PROBE_FAILED", "Could not determine frame rate");
  const durationSec = Number(json.format?.duration ?? video.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new EditError("PROBE_FAILED", "Could not determine duration");
  return {
    path: realPath,
    name: path.basename(realPath),
    durationSec,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps,
    hasVideo: true,
    audioStreams: streams
      .filter((s) => s.codec_type === "audio")
      .map((s) => ({
        index: s.index,
        codec: s.codec_name ?? "unknown",
        channels: s.channels ?? 0,
        sampleRate: Number(s.sample_rate ?? 0) || 0,
      })),
  };
}

/** Runs ffprobe without a shell; the path is already validated as absolute. */
export function ffprobeProbe(ffprobePath = process.env.CE_FFPROBE ?? "ffprobe"): ProbeFn {
  return (realPath) =>
    new Promise((resolve, reject) => {
      execFile(
        ffprobePath,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-i", realPath],
        { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: false },
        (err, stdout, stderr) => {
          if (err) {
            const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
            return reject(
              new EditError(
                "PROBE_FAILED",
                missing
                  ? "ffprobe was not found. Install FFmpeg and put ffprobe on PATH or set CE_FFPROBE."
                  : `ffprobe failed: ${String(stderr).trim().slice(0, 300) || err.message}`,
              ),
            );
          }
          try {
            resolve(parseFfprobe(JSON.parse(stdout) as FfprobeJson, realPath));
          } catch (e) {
            reject(e instanceof EditError ? e : new EditError("PROBE_FAILED", "ffprobe returned unreadable output"));
          }
        },
      );
    });
}

import { z } from "zod";

export const FORMAT_VERSION = 1;

export const FpsSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});
export type Fps = z.infer<typeof FpsSchema>;

export const AudioStreamSchema = z.object({
  index: z.number().int().nonnegative(),
  codec: z.string(),
  channels: z.number().int().nonnegative(),
  sampleRate: z.number().int().nonnegative(),
});
export type AudioStream = z.infer<typeof AudioStreamSchema>;

/** Probe output for a source file, before it is assigned an id/frame count. */
export const MediaProbeSchema = z.object({
  path: z.string(),
  name: z.string(),
  durationSec: z.number().positive(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  fps: FpsSchema,
  hasVideo: z.boolean(),
  audioStreams: z.array(AudioStreamSchema),
});
export type MediaProbe = z.infer<typeof MediaProbeSchema>;

export const MediaAssetSchema = MediaProbeSchema.extend({
  id: z.string(),
  /** Source duration in project frames. */
  durationFrames: z.number().int().positive(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

/** All frame fields are integer *project* frames. Single track, no overlaps. */
export const ClipSchema = z.object({
  id: z.string(),
  mediaId: z.string(),
  /** Position on the timeline. */
  startFrame: z.number().int().nonnegative(),
  /** First source frame used. */
  inFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
});
export type Clip = z.infer<typeof ClipSchema>;

/** The undoable part of a project. */
export const ContentSchema = z.object({
  fps: FpsSchema,
  nextId: z.number().int().positive(),
  media: z.array(MediaAssetSchema),
  clips: z.array(ClipSchema),
});
export type Content = z.infer<typeof ContentSchema>;

export const ProjectSchema = ContentSchema.extend({
  formatVersion: z.literal(FORMAT_VERSION),
  id: z.string(),
  name: z.string(),
  revision: z.number().int().nonnegative(),
});
export type Project = z.infer<typeof ProjectSchema>;

export function emptyContent(): Content {
  return { fps: { num: 30, den: 1 }, nextId: 1, media: [], clips: [] };
}

export function sortedClips(clips: readonly Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startFrame - b.startFrame);
}

export function clipEnd(c: Clip): number {
  return c.startFrame + c.durationFrames;
}

export function timelineDuration(clips: readonly Clip[]): number {
  return clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

export function framesToSeconds(frames: number, fps: Fps): number {
  return (frames * fps.den) / fps.num;
}

export function secondsToFrames(sec: number, fps: Fps): number {
  return Math.floor((sec * fps.num) / fps.den + 1e-6);
}

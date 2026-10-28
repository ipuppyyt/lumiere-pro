import { z } from "zod";
import { EditError } from "./errors";
import {
  clipEnd,
  secondsToFrames,
  sortedClips,
  MediaProbeSchema,
  type Clip,
  type Content,
} from "./model";

const Frame = z.number().int().nonnegative();

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("import_media"),
    probe: MediaProbeSchema,
    addToTimeline: z.boolean().default(true),
  }),
  z.object({ type: z.literal("split_clip"), clipId: z.string().min(1), atFrame: Frame }),
  z.object({
    type: z.literal("trim_clip"),
    clipId: z.string().min(1),
    side: z.enum(["start", "end"]),
    toFrame: Frame,
  }),
  z.object({ type: z.literal("move_clip"), clipId: z.string().min(1), startFrame: Frame }),
  z.object({ type: z.literal("remove_clip"), clipId: z.string().min(1) }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
]);
export type Command = z.infer<typeof CommandSchema>;
export type EditCommand = Exclude<Command, { type: "undo" } | { type: "redo" }>;

export interface Applied {
  content: Content;
  affectedClipIds: string[];
  affectedMediaIds: string[];
}

function findClip(content: Content, clipId: string): Clip {
  const clip = content.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditError("NOT_FOUND", `No clip with id "${clipId}"`);
  return clip;
}

function mediaFor(content: Content, clip: Clip) {
  const m = content.media.find((x) => x.id === clip.mediaId);
  if (!m) throw new EditError("NOT_FOUND", `Clip ${clip.id} references missing media ${clip.mediaId}`);
  return m;
}

/** Throws unless the clips are valid: in-bounds source ranges and no overlap on the track. */
export function validateTimeline(content: Content): void {
  for (const c of content.clips) {
    const m = mediaFor(content, c);
    if (c.inFrame + c.durationFrames > m.durationFrames) {
      throw new EditError(
        "INVALID_ARGUMENT",
        `Clip ${c.id} would use source frames up to ${c.inFrame + c.durationFrames} but the media has only ${m.durationFrames}`,
      );
    }
  }
  const s = sortedClips(content.clips);
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1]!;
    const cur = s[i]!;
    if (clipEnd(prev) > cur.startFrame) {
      throw new EditError(
        "OVERLAP",
        `Clip ${cur.id} (starts ${cur.startFrame}) would overlap ${prev.id} (ends ${clipEnd(prev)})`,
      );
    }
  }
}

function replaceClip(content: Content, next: Clip): Content {
  return { ...content, clips: content.clips.map((c) => (c.id === next.id ? next : c)) };
}

/** Pure: applies one edit command to content, returning new content or throwing EditError. */
export function applyEdit(content: Content, cmd: EditCommand): Applied {
  let out: Content;
  let clips: string[] = [];
  let media: string[] = [];

  switch (cmd.type) {
    case "import_media": {
      const p = cmd.probe;
      const fps = content.media.length === 0 ? p.fps : content.fps;
      const durationFrames = secondsToFrames(p.durationSec, fps);
      if (durationFrames < 1) throw new EditError("INVALID_ARGUMENT", "Media is shorter than one frame");
      const mediaId = `media_${content.nextId}`;
      let nextId = content.nextId + 1;
      out = { ...content, fps, media: [...content.media, { ...p, id: mediaId, durationFrames }] };
      media = [mediaId];
      if (cmd.addToTimeline) {
        const clipId = `clip_${nextId++}`;
        const startFrame = content.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
        out = {
          ...out,
          clips: [...out.clips, { id: clipId, mediaId, startFrame, inFrame: 0, durationFrames }],
        };
        clips = [clipId];
      }
      out = { ...out, nextId };
      break;
    }
    case "split_clip": {
      const c = findClip(content, cmd.clipId);
      if (cmd.atFrame <= c.startFrame || cmd.atFrame >= clipEnd(c)) {
        throw new EditError(
          "INVALID_ARGUMENT",
          `Split frame ${cmd.atFrame} must be strictly inside clip ${c.id} (${c.startFrame}..${clipEnd(c)})`,
        );
      }
      const leftDur = cmd.atFrame - c.startFrame;
      const left: Clip = { ...c, durationFrames: leftDur };
      const right: Clip = {
        id: `clip_${content.nextId}`,
        mediaId: c.mediaId,
        startFrame: cmd.atFrame,
        inFrame: c.inFrame + leftDur,
        durationFrames: c.durationFrames - leftDur,
      };
      out = replaceClip(content, left);
      out = { ...out, nextId: content.nextId + 1, clips: [...out.clips, right] };
      clips = [left.id, right.id];
      break;
    }
    case "trim_clip": {
      const c = findClip(content, cmd.clipId);
      let next: Clip;
      if (cmd.side === "start") {
        if (cmd.toFrame >= clipEnd(c)) {
          throw new EditError("INVALID_ARGUMENT", `Trim start ${cmd.toFrame} must be before clip end ${clipEnd(c)}`);
        }
        const delta = cmd.toFrame - c.startFrame;
        if (c.inFrame + delta < 0) {
          throw new EditError("INVALID_ARGUMENT", `Cannot extend clip ${c.id} start before the beginning of its source`);
        }
        next = { ...c, startFrame: cmd.toFrame, inFrame: c.inFrame + delta, durationFrames: c.durationFrames - delta };
      } else {
        if (cmd.toFrame <= c.startFrame) {
          throw new EditError("INVALID_ARGUMENT", `Trim end ${cmd.toFrame} must be after clip start ${c.startFrame}`);
        }
        next = { ...c, durationFrames: cmd.toFrame - c.startFrame };
      }
      if (next.startFrame === c.startFrame && next.durationFrames === c.durationFrames) {
        throw new EditError("INVALID_ARGUMENT", "Trim would not change the clip");
      }
      out = replaceClip(content, next);
      clips = [c.id];
      break;
    }
    case "move_clip": {
      const c = findClip(content, cmd.clipId);
      if (cmd.startFrame === c.startFrame) throw new EditError("INVALID_ARGUMENT", "Clip is already at that frame");
      out = replaceClip(content, { ...c, startFrame: cmd.startFrame });
      clips = [c.id];
      break;
    }
    case "remove_clip": {
      const c = findClip(content, cmd.clipId);
      out = { ...content, clips: content.clips.filter((x) => x.id !== c.id) };
      clips = [c.id];
      break;
    }
  }

  validateTimeline(out);
  return { content: out, affectedClipIds: clips, affectedMediaIds: media };
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_VERSION, EditError, framesToSeconds, timelineDuration, type Project } from "@lumiere-pro/core";
import { HostClient } from "./hostClient";

const Frame = z.number().int().nonnegative();
const Rev = z
  .number()
  .int()
  .nonnegative()
  .describe("The project revision you last read. Rejected with STALE_REVISION if the project has changed since.");

const text = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
  isError,
});

function summarize(p: Project) {
  return {
    revision: p.revision,
    name: p.name,
    fps: p.fps,
    durationFrames: timelineDuration(p.clips),
    durationSeconds: framesToSeconds(timelineDuration(p.clips), p.fps),
    media: p.media.map((m) => ({ id: m.id, name: m.name, durationFrames: m.durationFrames })),
    clips: [...p.clips].sort((a, b) => a.startFrame - b.startFrame),
    note: "All positions are integer project frames on a single track. Clips may not overlap; gaps are allowed.",
  };
}

export function createMcpServer(client = new HostClient()): McpServer {
  const server = new McpServer({ name: "lumiere-pro", version: APP_VERSION });

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      return text(await fn());
    } catch (e) {
      if (e instanceof EditError) return text({ ok: false, code: e.code, message: e.message }, true);
      console.error("[mcp] unexpected:", e);
      return text({ ok: false, code: "INTERNAL", message: "Unexpected error" }, true);
    }
  };

  const edit = (command: unknown, expectedRevision: number) =>
    guard(async () => {
      const r = await client.command(command, expectedRevision);
      if (!r.ok) {
        throw Object.assign(new EditError(r.code as never, r.message), { currentRevision: r.currentRevision });
      }
      const affected = r.project.clips.filter((c) => r.affectedClipIds.includes(c.id));
      return { ok: true, revision: r.revision, affectedClipIds: r.affectedClipIds, affectedClips: affected };
    }).then(async (res) => {
      // Surface the current revision on failures so the model can retry without an extra read.
      if (res.isError && (res.structuredContent as { code?: string }).code === "STALE_REVISION") {
        const s = await client.state().catch(() => null);
        if (s) {
          (res.structuredContent as Record<string, unknown>).currentRevision = s.project.revision;
          res.content[0]!.text = JSON.stringify(res.structuredContent, null, 2);
        }
      }
      return res;
    });

  server.registerTool(
    "get_project_state",
    {
      title: "Get project state",
      description:
        "Returns the current timeline: revision, frame rate, media and clips (all positions in integer project frames). Call this first and use its revision as expectedRevision for edits.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guard(async () => summarize((await client.state()).project)),
  );

  server.registerTool(
    "list_media",
    {
      title: "List media",
      description: "Lists imported source media with duration, dimensions, frame rate and audio streams.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const p = (await client.state()).project;
        return { revision: p.revision, fps: p.fps, media: p.media };
      }),
  );

  server.registerTool(
    "split_clip",
    {
      title: "Split clip",
      description:
        "Splits a clip in two at a timeline frame strictly inside it. The left part keeps the clip ID; the right part gets a new ID.",
      inputSchema: {
        clipId: z.string().min(1),
        atFrame: Frame.describe("Timeline frame to cut at (must be inside the clip, not on its edges)."),
        expectedRevision: Rev,
      },
    },
    ({ clipId, atFrame, expectedRevision }) => edit({ type: "split_clip", clipId, atFrame }, expectedRevision),
  );

  server.registerTool(
    "trim_clip",
    {
      title: "Trim clip",
      description:
        "Moves one edge of a clip to a timeline frame. side=start keeps the picture in place and cuts/extends the head; side=end cuts/extends the tail. Cannot extend past the source media or into a neighbouring clip.",
      inputSchema: {
        clipId: z.string().min(1),
        side: z.enum(["start", "end"]),
        toFrame: Frame.describe("The new timeline frame of that edge."),
        expectedRevision: Rev,
      },
    },
    ({ clipId, side, toFrame, expectedRevision }) =>
      edit({ type: "trim_clip", clipId, side, toFrame }, expectedRevision),
  );

  server.registerTool(
    "move_clip",
    {
      title: "Move clip",
      description: "Moves a clip so it starts at the given timeline frame. Rejected if it would overlap another clip.",
      inputSchema: { clipId: z.string().min(1), startFrame: Frame, expectedRevision: Rev },
    },
    ({ clipId, startFrame, expectedRevision }) => edit({ type: "move_clip", clipId, startFrame }, expectedRevision),
  );

  server.registerTool(
    "remove_clip",
    {
      title: "Remove clip",
      description: "Deletes a clip from the timeline, leaving a gap. Source media is never touched.",
      inputSchema: { clipId: z.string().min(1), expectedRevision: Rev },
      annotations: { destructiveHint: true },
    },
    ({ clipId, expectedRevision }) => edit({ type: "remove_clip", clipId }, expectedRevision),
  );

  server.registerTool(
    "undo_edit",
    {
      title: "Undo edit",
      description: "Undoes the most recent edit (by anyone, user or Claude). Fails if there is nothing to undo.",
      inputSchema: { expectedRevision: Rev },
    },
    ({ expectedRevision }) => edit({ type: "undo" }, expectedRevision),
  );

  return server;
}
